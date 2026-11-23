import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
import { cancelarItem } from '@/server/reservas/cancelar';
import { cancelarTodos } from '@/server/reservas/cancelar-todos';
import { marcarStatusDoItem } from '@/server/reservas/marcar-status';
import { remarcarItem } from '@/server/reservas/remarcar';

import { contarLinhas } from '../../../support/reservas';

import type { Cenario } from './apoio';
import { AGORA, conferirDerivados, consentirConvite, criarCenario, criarComItens, DEPOIS, DIA, db, filaEspia, itemDe, mensagensDe, reservaDe, sp } from './apoio';

// D-050 T-6: cancelar item (CA-27, CA-29, CA-38, CA-39) e cancelar todos (CA-28, RN-24) contra PostgreSQL real.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const cancelar = (c: Cenario, reservaId: string, itemId: string, agora = AGORA, fila = filaEspia()) =>
  cancelarItem(c.ctxEquipe, { reservaId, itemId }, agora, { enfileirar: fila.enfileirar });

describe('CA-27: cancelar X', () => {
  it('X cancelado, Y confirmado, derivado confirmado, revisão +1, cancelamento de X; o horário de X volta à disponibilidade', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    const oferecido = async () => {
      const r = await consultarDisponibilidadePorServico(c.ctxEquipe, { servicoIds: [c.A], de: DIA, ate: DIA, agora: AGORA });
      if (r.resultado !== 'ok') throw new Error(r.resultado);
      return horarioOferecido(r.servicos[0], c.ana, sp(DIA, '10:00'));
    };
    expect(await oferecido()).toBe(false);
    const yAntes = await itemDe(y);

    const fila = filaEspia();
    const r = await cancelar(c, id, x, AGORA, fila);
    expect(r).toMatchObject({ resultado: 'atualizada', itemId: x, status: 'cancelado', statusReserva: 'confirmado', revisao: 1 });
    expect(await itemDe(x)).toMatchObject({ status: 'cancelado', revisao: 1 });
    expect(await itemDe(y)).toEqual(yAntes);
    const reserva = await reservaDe(id);
    expect(reserva).toMatchObject({ status: 'confirmado', revisao: 1, canceladaEm: null });
    // A-2: envelope só sobre o não cancelado.
    expect(reserva.inicio).toEqual(sp(DIA, '11:00'));
    await conferirDerivados(id);
    expect(await oferecido()).toBe(true);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'pendente', reservaItemId: null },
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: x },
    ]);
    expect(fila.chaves()).toEqual([`${id}:cancelamento:1`]);
  });

  it('CA-38 + CA-39: X e depois Y → revisões 1 e 2, cada uma do seu item; reserva cancelada; confirmação substituída', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    await cancelar(c, id, x);
    const depois = new Date(AGORA.getTime() + 60_000);
    const r = await cancelar(c, id, y, depois);
    expect(r).toMatchObject({ resultado: 'atualizada', statusReserva: 'cancelado', revisao: 2 });
    const reserva = await reservaDe(id);
    expect(reserva).toMatchObject({ status: 'cancelado', revisao: 2 });
    expect(reserva.canceladaEm).toEqual(depois);
    await conferirDerivados(id);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida', reservaItemId: null },
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: x },
      { tipo: 'cancelamento', revisao: 2, estado: 'pendente', reservaItemId: y },
    ]);
  });

  it('remarcação pendente de X é substituída quando X é cancelado (vigência)', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '14:00' }, AGORA, { enfileirar: filaEspia().enfileirar });
    await cancelar(c, id, x);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'pendente', reservaItemId: null },
      { tipo: 'remarcacao', revisao: 1, estado: 'substituida', reservaItemId: x },
      { tipo: 'cancelamento', revisao: 2, estado: 'pendente', reservaItemId: x },
    ]);
  });
});

describe('CA-29: recusas da máquina por item, sem gravar', () => {
  it('cancelar com agora ≥ fim do item → ja_terminada; repetir o cancelamento → item_final', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '15:00' }]);
    const antes = { r: await reservaDe(id), n: await contarLinhas(c.s.salaoId) };
    // 10:30 é o fim de X: recusa; Y (15:00) ainda pode.
    expect(await cancelar(c, id, x, sp(DIA, '10:30'))).toEqual({ resultado: 'recusado', motivo: 'ja_terminada' });
    expect(await reservaDe(id)).toEqual(antes.r);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
    expect((await cancelar(c, id, y, sp(DIA, '10:30'))).resultado).toBe('atualizada');
    expect(await cancelar(c, id, y, sp(DIA, '10:31'))).toEqual({ resultado: 'recusado', motivo: 'item_final' });
    await conferirDerivados(id);
  });

  it('marcar concluído com agora < início → ainda_nao_iniciada; item cancelado não aceita nenhuma transição', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: x, destino: 'concluido' }, sp(DIA, '09:59'))).toEqual({
      resultado: 'recusado',
      motivo: 'ainda_nao_iniciada',
    });
    await cancelar(c, id, y);
    for (const destino of ['concluido', 'nao_compareceu']) {
      expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: y, destino }, DEPOIS)).toEqual({ resultado: 'recusado', motivo: 'item_final' });
    }
    // Destino fora da lista da operação: recusado sem gravar.
    expect(await marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: x, destino: 'cancelado' }, DEPOIS)).toEqual({
      resultado: 'recusado',
      motivo: 'transicao_invalida',
    });
    expect((await reservaDe(id)).revisao).toBe(1);
    await conferirDerivados(id);
  });
});

describe('CA-28: cancelar todos', () => {
  it('X concluído, Y e Z futuros: Y e Z cancelados, X intacto, revisão +1, UMA mensagem sem item; derivado concluido e convite', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y, z] } = await criarComItens(c, [
      { hora: '10:00' },
      { servicoId: c.C, profissionalId: c.bia, hora: '15:00' },
      { servicoId: c.B, hora: '16:00' },
    ]);
    await consentirConvite(id);
    const agora = sp(DIA, '11:00');
    expect((await marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: x, destino: 'concluido' }, agora)).resultado).toBe('atualizada');
    const fila = filaEspia();
    const r = await cancelarTodos(c.ctxEquipe, { reservaId: id }, agora, { enfileirar: fila.enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', itemIds: [y, z], revisao: 1, statusReserva: 'concluido' });
    expect(await itemDe(x)).toMatchObject({ status: 'concluido', revisao: 0 });
    expect(await itemDe(y)).toMatchObject({ status: 'cancelado', revisao: 1 });
    expect(await itemDe(z)).toMatchObject({ status: 'cancelado', revisao: 1 });
    const reserva = await reservaDe(id);
    expect(reserva).toMatchObject({ status: 'concluido', revisao: 1, canceladaEm: null });
    await conferirDerivados(id);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida', reservaItemId: null },
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: null },
      { tipo: 'convite_avaliacao', revisao: 0, estado: 'pendente', reservaItemId: null },
    ]);
    expect(fila.chaves().sort()).toEqual([`${id}:cancelamento:1`, `${id}:convite_avaliacao:0`].sort());
  });

  it('itens já terminados ficam como estão; todos futuros → reserva cancelada com cancelada_em', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '15:00' }]);
    const r = await cancelarTodos(c.ctxEquipe, { reservaId: id }, sp(DIA, '12:00'), { enfileirar: filaEspia().enfileirar });
    // X (10:00–10:30) já terminou: continua confirmado; só Y é cancelado.
    expect(r).toMatchObject({ resultado: 'atualizada', itemIds: [y], statusReserva: 'confirmado' });
    expect(await itemDe(x)).toMatchObject({ status: 'confirmado' });

    const c2 = await criarCenario();
    const dois = await criarComItens(c2, [{ hora: '10:00' }, { servicoId: c2.C, profissionalId: c2.bia, hora: '15:00' }]);
    expect(await cancelarTodos(c2.ctxEquipe, { reservaId: dois.id }, AGORA, { enfileirar: filaEspia().enfileirar })).toMatchObject({
      resultado: 'atualizada',
      itemIds: dois.itens,
      statusReserva: 'cancelado',
    });
    expect(await reservaDe(dois.id)).toMatchObject({ status: 'cancelado', canceladaEm: AGORA });
    await conferirDerivados(id);
    await conferirDerivados(dois.id);
  });

  it('nenhum cancelável → nenhum_cancelavel sem gravar nem enfileirar', async () => {
    const c = await criarCenario();
    const { id } = await criarComItens(c, [{ hora: '10:00' }]);
    const antes = { r: await reservaDe(id), n: await contarLinhas(c.s.salaoId) };
    const fila = filaEspia();
    expect(await cancelarTodos(c.ctxEquipe, { reservaId: id }, DEPOIS, { enfileirar: fila.enfileirar })).toEqual({
      resultado: 'recusado',
      motivo: 'nenhum_cancelavel',
    });
    expect(await reservaDe(id)).toEqual(antes.r);
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes.n);
    expect(fila.total()).toBe(0);
    expect(await db().mensagem.count({ where: { reservaId: id, tipo: 'cancelamento' } })).toBe(0);
  });
});
