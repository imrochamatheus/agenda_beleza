import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';

import { DIA, contarLinhas, criarCenarioReserva, entradaReserva, esperarTrava, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import { item, jornadaDaBia } from './apoio-itens';

// D-050 T-5: CA-18 (RN-13, §4.6). Profissionais dos itens FOR NO KEY UPDATE em ordem de id, sem repetição,
// ANTES dos serviços FOR SHARE: reservas com profissionais cruzados nunca terminam em impasse. Caso
// determinístico com pg_stat_activity e NOWAIT na conexão `pg` própria (sem sleep fixo).

let c: pg.Client;
let trava: pg.Client;
let sonda: pg.Client;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  sonda = await conectar();
});
afterAll(async () => {
  await sonda.end();
  await trava.end();
  await c.end();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });

/** Se a linha estiver travada por outra transação, NOWAIT falha com 55P03. */
async function livre(tabela: 'profissional' | 'servico', id: string): Promise<boolean> {
  await sonda.query('BEGIN');
  try {
    await sonda.query(`SELECT 1 FROM ${tabela} WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, [id]);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') return false;
    throw e;
  } finally {
    await sonda.query('ROLLBACK');
  }
}

/** A Bia faz A; a Ana faz A e B. Itens em horários distintos e livres. */
const cruzada = (cen: CenarioReserva, ordemBiaPrimeiro: boolean, h: [string, string]) => {
  const daBia = item(cen, sp(DIA, h[0]), { profissionalId: cen.bia });
  const daAna = item(cen, sp(DIA, h[1]), { servicoId: cen.B });
  return entradaReserva(cen, { itens: ordemBiaPrimeiro ? [daBia, daAna] : [daAna, daBia] });
};

describe('CA-18: itens com profissionais cruzados', () => {
  it('{Bia, Ana} × {Ana, Bia} em paralelo, 10 vezes: ambas criadas, sem impasse (40P01) nem erro', async () => {
    for (let i = 0; i < 10; i++) {
      const cen = await criarCenarioReserva();
      await jornadaDaBia(cen);
      const rs = await Promise.allSettled([
        criarReserva(cen.ctxSistema, cruzada(cen, true, ['09:00', '10:00']), { enfileirar }),
        criarReserva(cen.ctxSistema, cruzada(cen, false, ['14:00', '15:00']), { enfileirar }),
      ]);
      expect(rs.map((r) => (r.status === 'fulfilled' ? r.value.resultado : String(r.reason)))).toEqual(['criada', 'criada']);
      expect(await contarLinhas(cen.s.salaoId)).toMatchObject({ reserva: 2, itens: 4 });
    }
  });

  it('determinístico: com o profissional de MENOR id travado, a criação espera nele sem ter travado o de maior id (mesmo pedido primeiro)', async () => {
    const cen = await criarCenarioReserva();
    await jornadaDaBia(cen);
    const [menor, maior] = [cen.ana, cen.bia].sort();
    // O item do profissional de MAIOR id vem primeiro no pedido: a trava segue a ordem de id, não a do pedido.
    const pedido = cruzada(cen, maior === cen.bia, ['09:00', '10:00']);
    await trava.query('BEGIN');
    try {
      await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR NO KEY UPDATE', [menor]);
      const p = criarReserva(cen.ctxSistema, pedido, { enfileirar });
      await esperarTrava(c, 'FOR NO KEY UPDATE OF p', 1);
      expect(await livre('profissional', maior)).toBe(true);
      expect(await livre('servico', cen.A)).toBe(true);
      await trava.query('COMMIT');
      expect((await p).resultado).toBe('criada');
    } catch (e) {
      await trava.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });

  it('determinístico: com um serviço travado, a criação espera em FOR SHARE OF s já segurando os DOIS profissionais', async () => {
    const cen = await criarCenarioReserva();
    await jornadaDaBia(cen);
    await trava.query('BEGIN');
    try {
      await trava.query('SELECT 1 FROM servico WHERE id = $1 FOR NO KEY UPDATE', [cen.B]);
      const p = criarReserva(cen.ctxSistema, cruzada(cen, true, ['09:00', '10:00']), { enfileirar });
      await esperarTrava(c, 'FOR SHARE OF s', 1);
      expect(await livre('profissional', cen.ana)).toBe(false);
      expect(await livre('profissional', cen.bia)).toBe(false);
      await trava.query('COMMIT');
      expect((await p).resultado).toBe('criada');
    } catch (e) {
      await trava.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });

  it('o mesmo profissional em dois itens é travado uma só vez (sem repetição, sem auto-espera)', async () => {
    const cen = await criarCenarioReserva();
    const r = await criarReserva(
      cen.ctxSistema,
      entradaReserva(cen, { itens: [item(cen, sp(DIA, '09:00')), item(cen, sp(DIA, '10:00'), { servicoId: cen.B })] }),
      { enfileirar },
    );
    expect(r.resultado).toBe('criada');
  });
});
