import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { integracoes } from '@/server/integrations/registry';

import { semearComplementoE2E } from '../../../prisma/seed';
import { SALOES_E2E_RESERVAS, slugE2eReservas } from '../../../prisma/seed/complemento-e2e';
import {
  contarReservas,
  criarReservaConcluida,
  ocuparHorario,
  reservasDoTelefone,
} from '../../../e2e/suporte/fixtures';
import { urlDoWorker } from '../../support/db';
import { conferirDerivados } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { prepararArmazenamento } from './apoio';

// D-050 T-14: o complemento do E2E e as fixtures SQL do E2E (`e2e/suporte/fixtures.ts`) no modelo de itens,
// contra o PostgreSQL real. As fixtures leem `E2E_DATABASE_URL`, apontada aqui para a base do worker.

const SLUG = slugE2eReservas(1);
let c: pg.Client;
let arm: ReturnType<typeof prepararArmazenamento>;

beforeAll(async () => {
  c = await conectar();
  arm = prepararArmazenamento();
  vi.stubEnv('E2E_DATABASE_URL', urlDoWorker());
  await semearComplementoE2E({ armazenamento: integracoes().armazenamento });
}, 120_000);
afterAll(async () => {
  arm.encerrar();
  await c.end();
});

async function telefoneDaReserva(id: string): Promise<string> {
  return (await c.query(`SELECT cl.telefone_e164 FROM reserva r JOIN cliente cl ON cl.id = r.cliente_id WHERE r.id = $1`, [id])).rows[0]
    .telefone_e164 as string;
}

describe('complemento do E2E', () => {
  it('cada salão de reserva tem Manicure só com Duda e derivados coerentes em todas as reservas', async () => {
    const r = await c.query(`
      SELECT sl.slug, string_agg(p.nome, ',' ORDER BY p.nome) AS profissionais
        FROM salao_slug sl
        JOIN servico v ON v.salao_id = sl.salao_id AND v.nome = 'Manicure'
        JOIN servico_profissional sp ON sp.salao_id = v.salao_id AND sp.servico_id = v.id
        JOIN profissional p ON p.salao_id = sp.salao_id AND p.id = sp.profissional_id
       WHERE sl.slug LIKE 'e2e-reservas-%' GROUP BY sl.slug`);
    expect(r.rows).toHaveLength(SALOES_E2E_RESERVAS);
    expect(new Set(r.rows.map((x) => x.profissionais))).toEqual(new Set(['Duda']));
    const saloes = (await c.query('SELECT id FROM salao')).rows;
    for (const s of saloes) expect(await conferirDerivados({ salaoId: s.id })).toBeGreaterThan(0);
  });
});

describe('fixtures do E2E', () => {
  const inicio = new Date('2031-03-10T13:00:00Z');

  it('ocuparHorario grava 1 reserva com 1 item coerente; o mesmo horário de novo esbarra na exclusion do item', async () => {
    const antes = await contarReservas(SLUG);
    const id = await ocuparHorario(SLUG, 'Ana', inicio, 60);
    expect(await contarReservas(SLUG)).toBe(antes + 1);
    await conferirDerivados(id);

    const [reserva, ...resto] = await reservasDoTelefone(SLUG, await telefoneDaReserva(id));
    expect(resto).toEqual([]);
    expect(reserva).toEqual({
      id,
      inicio,
      fim: new Date(inicio.getTime() + 60 * 60_000),
      status: 'confirmado',
      itens: [
        {
          servico: 'Corte',
          profissional: 'Ana',
          ordem: 0,
          inicio,
          fim: new Date(inicio.getTime() + 60 * 60_000),
          status: 'confirmado',
          precoCentavos: 9000,
          duracaoMin: 60,
        },
      ],
    });
    const item = (await c.query(`SELECT ocupado_ate FROM reserva_item WHERE reserva_id = $1`, [id])).rows[0];
    expect(item.ocupado_ate).toEqual(new Date(inicio.getTime() + 60 * 60_000));

    await expect(ocuparHorario(SLUG, 'Ana', new Date(inicio.getTime() + 30 * 60_000), 30, 'Escova')).rejects.toMatchObject({
      code: '23P01',
      constraint: 'reserva_item_sem_sobreposicao',
    });
    // A recusa não deixa reserva sem item (as duas linhas estão no mesmo comando).
    expect(await contarReservas(SLUG)).toBe(antes + 1);
  });

  it('ocuparHorario com serviço que o profissional não executa falha antes de gravar', async () => {
    const antes = await contarReservas(SLUG);
    await expect(ocuparHorario(SLUG, 'Ana', inicio, 45, 'Manicure')).rejects.toThrow('Ana não executa o serviço pedido');
    expect(await contarReservas(SLUG)).toBe(antes);
  });

  it('ocuparHorario de outro profissional no mesmo horário é aceito (a exclusion é por profissional)', async () => {
    const id = await ocuparHorario(SLUG, 'Duda', inicio, 45, 'Manicure');
    await conferirDerivados(id);
    const [r] = await reservasDoTelefone(SLUG, await telefoneDaReserva(id));
    expect(r!.itens.map((i) => [i.servico, i.profissional, i.duracaoMin])).toEqual([['Manicure', 'Duda', 45]]);
  });

  it('criarReservaConcluida grava uma reserva concluída no passado, com item de Corte com Ana', async () => {
    const { reservaId, salaoId, clienteNome } = await criarReservaConcluida(SLUG);
    await conferirDerivados(reservaId);
    const r = (
      await c.query(
        `SELECT r.status::text AS status, r.salao_id, cl.nome, i.status::text AS item, p.nome AS profissional, r.fim < now() AS passada
           FROM reserva r JOIN cliente cl ON cl.id = r.cliente_id
           JOIN reserva_item i ON i.reserva_id = r.id JOIN profissional p ON p.id = i.profissional_id
          WHERE r.id = $1`,
        [reservaId],
      )
    ).rows;
    expect(r).toEqual([{ status: 'concluido', salao_id: salaoId, nome: clienteNome, item: 'concluido', profissional: 'Ana', passada: true }]);
  });
});
