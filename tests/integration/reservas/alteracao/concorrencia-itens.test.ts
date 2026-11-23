import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelarItem } from '@/server/reservas/cancelar';
import { cancelarTodos } from '@/server/reservas/cancelar-todos';
import { marcarStatusDoItem } from '@/server/reservas/marcar-status';
import { remarcarItem } from '@/server/reservas/remarcar';

import { esperarTrava } from '../../../support/reservas';
import { conectar } from '../../../support/sql';

import type { Cenario } from './apoio';
import { AGORA, conferirDerivados, criarCenario, criarComItens, DEPOIS, filaEspia, itemDe, mensagensDe, reservaDe, sp } from './apoio';

// D-050 T-6: concorrência das operações por item (CA-21, RN-13, §4.6) e casos determinísticos de ordem de
// travas com pg_stat_activity e NOWAIT numa conexão `pg` própria (sem sleep fixo). Laço ×10 no CLAUDE.md.

let trava: pg.Client;
let sonda: pg.Client;
let espiao: pg.Client;

beforeAll(async () => {
  trava = await conectar();
  sonda = await conectar();
  espiao = await conectar();
});
afterAll(async () => {
  await espiao.end();
  await sonda.end();
  await trava.end();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

const deps = () => ({ enfileirar: filaEspia().enfileirar });

/** Se a linha estiver travada por outra transação de forma incompatível, NOWAIT falha com 55P03. */
async function livre(tabela: 'profissional' | 'servico' | 'reserva', id: string): Promise<boolean> {
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

const reservaDeDois = (c: Cenario, h: [string, string] = ['10:00', '11:00']) =>
  criarComItens(c, [{ hora: h[0] }, { servicoId: c.C, profissionalId: c.bia, hora: h[1] }]);

describe('CA-21: remarcar X × cancelar Y da mesma reserva, em paralelo', () => {
  it('10 vezes: ambas concluem (serializadas pela reserva), revisão inicial + 2, duas mensagens de chaves diferentes', async () => {
    const c = await criarCenario();
    for (let i = 0; i < 10; i++) {
      const hora = String(9 + i).padStart(2, '0');
      // X = A Ana (hh:00); Y = C Bia (hh:40), cada volta num horário livre.
      const { id, itens: [x, y] } = await criarComItens(c, [
        { hora: `${hora}:00`, data: { ano: 2026, mes: 12, dia: 2 + i } },
        { servicoId: c.C, profissionalId: c.bia, hora: `${hora}:40`, data: { ano: 2026, mes: 12, dia: 2 + i } },
      ]);
      const fila = filaEspia();
      const [r, k] = await Promise.all([
        remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: `${hora}:05` }, AGORA, { enfileirar: fila.enfileirar }),
        cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, AGORA, { enfileirar: fila.enfileirar }),
      ]);
      expect(r.resultado, `volta ${i}`).toBe('atualizada');
      expect(k.resultado, `volta ${i}`).toBe('atualizada');
      const reserva = await reservaDe(id);
      expect(reserva).toMatchObject({ revisao: 2, status: 'confirmado' });
      const msgs = (await mensagensDe(id)).filter((m) => m.tipo !== 'confirmacao');
      expect(msgs.map((m) => m.revisao).sort()).toEqual([1, 2]);
      expect(new Set(fila.chaves()).size).toBe(2);
      expect(msgs.find((m) => m.tipo === 'remarcacao')?.reservaItemId).toBe(x);
      expect(msgs.find((m) => m.tipo === 'cancelamento')?.reservaItemId).toBe(y);
      expect((await itemDe(x)).revisao + (await itemDe(y)).revisao).toBe(3);
      await conferirDerivados(id);
    }
  });
});

describe('remarcação cruzada entre profissionais (RN-13)', () => {
  it('R1: item da Ana → Bia e R2: item da Bia → Ana, em paralelo, 10 vezes: sem impasse (40P01) nem erro', async () => {
    const c = await criarCenario();
    for (let i = 0; i < 10; i++) {
      const data = { ano: 2026, mes: 12, dia: 2 + i };
      const r1 = await criarComItens(c, [{ hora: '10:00', data }]);
      const r2 = await criarComItens(c, [{ profissionalId: c.bia, hora: '12:00', data }]);
      const [a, b] = await Promise.all([
        remarcarItem(c.ctxEquipe, { reservaId: r1.id, itemId: r1.itens[0], profissionalId: c.bia, hora: '15:00' }, AGORA, deps()),
        remarcarItem(c.ctxEquipe, { reservaId: r2.id, itemId: r2.itens[0], profissionalId: c.ana, hora: '16:00' }, AGORA, deps()),
      ]);
      expect([a.resultado, b.resultado], `volta ${i}`).toEqual(['atualizada', 'atualizada']);
      expect(await itemDe(r1.itens[0])).toMatchObject({ profissionalId: c.bia, inicio: sp(data, '15:00') });
      expect(await itemDe(r2.itens[0])).toMatchObject({ profissionalId: c.ana, inicio: sp(data, '16:00') });
    }
    await conferirDerivados({ salaoId: c.s.salaoId });
  });

  it('dois itens disputando o mesmo horário do mesmo profissional: um vence, o outro recebe 23P01; nunca os dois', async () => {
    const c = await criarCenario();
    for (let i = 0; i < 10; i++) {
      const data = { ano: 2026, mes: 12, dia: 2 + i };
      const r1 = await criarComItens(c, [{ hora: '10:00', data }]);
      const r2 = await criarComItens(c, [{ profissionalId: c.bia, hora: '12:00', data }]);
      const resultados = await Promise.all([
        remarcarItem(c.ctxEquipe, { reservaId: r1.id, itemId: r1.itens[0], profissionalId: c.bia, hora: '15:00' }, AGORA, deps()),
        remarcarItem(c.ctxEquipe, { reservaId: r2.id, itemId: r2.itens[0], hora: '15:10' }, AGORA, deps()),
      ]);
      expect(resultados.map((x) => x.resultado).sort(), `volta ${i}`).toEqual(['atualizada', 'horario_indisponivel']);
    }
    await conferirDerivados({ salaoId: c.s.salaoId });
  });
});

describe('mesmo item em paralelo', () => {
  it('cancelar × remarcar o mesmo item, 10 vezes: serializados, desfechos coerentes, derivados consistentes', async () => {
    const c = await criarCenario();
    for (let i = 0; i < 10; i++) {
      const data = { ano: 2026, mes: 12, dia: 2 + i };
      const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00', data }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00', data }]);
      const [k, r] = await Promise.all([
        cancelarItem(c.ctxEquipe, { reservaId: id, itemId: x }, AGORA, deps()),
        remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, deps()),
      ]);
      expect(k.resultado).toBe('atualizada');
      // O cancelamento antes: a remarcação vê o item cancelado. Depois: as duas valem (revisão 2).
      if (r.resultado === 'atualizada') expect((await reservaDe(id)).revisao).toBe(2);
      else expect(r).toEqual({ resultado: 'recusado', motivo: 'item_final' });
      expect((await itemDe(x)).status).toBe('cancelado');
      await conferirDerivados(id);
    }
  });

  it('cancelar todos × marcar status de outro item, 10 vezes: sem impasse; derivados consistentes', async () => {
    const c = await criarCenario();
    for (let i = 0; i < 10; i++) {
      const data = { ano: 2026, mes: 12, dia: 2 + i };
      const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00', data }, { servicoId: c.C, profissionalId: c.bia, hora: '15:00', data }]);
      const agora = sp(data, '12:00');
      const [t, m] = await Promise.all([
        cancelarTodos(c.ctxEquipe, { reservaId: id }, agora, deps()),
        marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: x, destino: 'concluido' }, agora, deps()),
      ]);
      expect(t).toMatchObject({ resultado: 'atualizada' });
      expect(m).toMatchObject({ resultado: 'atualizada', status: 'concluido' });
      expect((await reservaDe(id)).status).toBe('concluido');
      await conferirDerivados(id);
    }
  });
});

describe('ordem de travas (determinístico, pg_stat_activity)', () => {
  it('R-9/Q13: com o profissional travado FOR UPDATE (como a desativação), cancelar e marcar status do item dele NÃO esperam', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    const outra = await reservaDeDois(c, ['14:00', '15:00']);
    await trava.query('BEGIN');
    try {
      await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR UPDATE', [c.ana]);
      expect(await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: x }, AGORA, deps())).toMatchObject({ resultado: 'atualizada' });
      expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: outra.id, itemId: outra.itens[0], destino: 'concluido' }, DEPOIS, deps())).toMatchObject({
        resultado: 'atualizada',
      });
      expect(await cancelarTodos(c.ctxEquipe, { reservaId: id }, AGORA, deps())).toMatchObject({ resultado: 'atualizada', itemIds: [y] });
    } finally {
      await trava.query('ROLLBACK');
    }
  });

  it('remarcar ESPERA a trava do profissional alvo (FOR NO KEY UPDATE) e conclui quando ela sai', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(c);
    await trava.query('BEGIN');
    let pendente: Promise<unknown> | null = null;
    try {
      await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR UPDATE', [c.bia]);
      pendente = remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, profissionalId: c.bia, hora: '14:00' }, AGORA, deps());
      await esperarTrava(espiao, 'FOR NO KEY UPDATE OF p');
      // Ainda não chegou à reserva.
      expect(await livre('reserva', id)).toBe(true);
    } finally {
      await trava.query('ROLLBACK');
    }
    expect(await pendente).toMatchObject({ resultado: 'atualizada' });
  });

  it('remarcar: profissionais e serviço já travados quando espera a reserva (profissional → serviço → cliente → reserva)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(c);
    await trava.query('BEGIN');
    let pendente: Promise<unknown> | null = null;
    try {
      await trava.query('SELECT 1 FROM reserva WHERE id = $1 FOR UPDATE', [id]);
      pendente = remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, profissionalId: c.bia, servicoId: c.C, hora: '14:00' }, AGORA, deps());
      await esperarTrava(espiao, 'FOR UPDATE OF r');
      expect(await livre('profissional', c.bia)).toBe(false);
      expect(await livre('profissional', c.ana)).toBe(false);
      // FOR SHARE no serviço conflita com o FOR NO KEY UPDATE NOWAIT da sonda.
      expect(await livre('servico', c.C)).toBe(false);
      expect(await livre('servico', c.A)).toBe(false);
    } finally {
      await trava.query('ROLLBACK');
    }
    // C já é o serviço de Y: servico_repetido (M-5), decidido só depois da trava da reserva.
    expect(await pendente).toEqual({ resultado: 'recusado', motivo: 'servico_repetido' });
  });

  it('cancelar item: espera a reserva SEM travar profissional nem serviço', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await reservaDeDois(c);
    await trava.query('BEGIN');
    let pendente: Promise<unknown> | null = null;
    try {
      await trava.query('SELECT 1 FROM reserva WHERE id = $1 FOR UPDATE', [id]);
      pendente = cancelarItem(c.ctxEquipe, { reservaId: id, itemId: x }, AGORA, deps());
      await esperarTrava(espiao, 'FOR UPDATE OF r');
      expect(await livre('profissional', c.ana)).toBe(true);
      expect(await livre('servico', c.A)).toBe(true);
    } finally {
      await trava.query('ROLLBACK');
    }
    expect(await pendente).toMatchObject({ resultado: 'atualizada' });
  });
});
