import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nomeDoWorker } from '../../support/db';
import { criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { aceitas, disputar, registroDoWorker } from './disputa';

// CA-6 (arquivo A): 12 transações concorrentes no MESMO profissional e MESMO horário. Exatamente uma é
// aceita; as outras 11 são recusadas pela exclusion `reserva_item_sem_sobreposicao` (23P01, D-050). Roda em paralelo
// com o arquivo B, em outro worker e outra base: nenhum vê os dados do outro. Sobre a trava do
// profissional, ver o comentário de ./disputa.ts.

const N = 12;
let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});

describe('CA-6 (A): disputa pelo mesmo horário em transações concorrentes', () => {
  it('CA-6: o arquivo roda na base do próprio worker (registro de VITEST_POOL_ID e base)', async () => {
    const reg = registroDoWorker('reserva-paralela-a');
    expect(Number(reg.poolId)).toBeGreaterThanOrEqual(1);
    const r = await c.query<{ b: string }>('SELECT current_database() AS b');
    expect(r.rows[0].b).toBe(nomeDoWorker());
  });

  it(`CA-6: ${N} reservas simultâneas no mesmo horário → exatamente 1 aceita e ${N - 1} recusadas por 23P01`, async () => {
    const inicio = instanteFuturo(10, 14);
    const resultados = await disputar(
      Array.from({ length: N }, () => ({
        salaoId: s.salaoId,
        profissionalId: s.profissional.profissionalId,
        clienteId: s.clientes.ativaId,
        servicoId: s.servicos.ativos[0],
        inicio,
        duracaoMin: 60,
      })),
      { travarProfissional: true },
    );
    const aceita = aceitas(resultados);
    expect(aceita).toHaveLength(1);
    expect(resultados.filter((r) => !r.aceita)).toEqual(
      Array.from({ length: N - 1 }, () => ({ aceita: false, code: '23P01', constraint: 'reserva_item_sem_sobreposicao' })),
    );

    // No banco: uma única reserva no horário, com o seu item (as recusadas não deixaram rastro).
    const reservas = await c.query<{ id: string }>(
      'SELECT DISTINCT reserva_id AS id FROM reserva_item WHERE salao_id = $1 AND profissional_id = $2 AND inicio = $3',
      [s.salaoId, s.profissional.profissionalId, inicio],
    );
    expect(reservas.rows).toEqual([{ id: aceita[0].reservaId }]);
    const itens = await c.query('SELECT count(*)::int AS n FROM reserva_item WHERE salao_id = $1 AND reserva_id = $2', [
      s.salaoId,
      aceita[0].reservaId,
    ]);
    expect(itens.rows).toEqual([{ n: 1 }]);
  });

  it('CA-6: a base deste worker contém só o salão criado por este arquivo', async () => {
    const r = await c.query<{ id: string }>('SELECT id FROM salao');
    expect(r.rows).toEqual([{ id: s.salaoId }]);
  });
});
