import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelarItem } from '@/server/reservas/cancelar';
import { marcarStatusDoItem } from '@/server/reservas/marcar-status';

import type { Cenario } from './apoio';
import { conferirDerivados, consentirConvite, criarCenario, criarComItens, DEPOIS, DIA, filaEspia, itemDe, mensagensDe, reservaDe, sp } from './apoio';

// D-050 T-6: marcar status por item e o convite de avaliação pelo status DERIVADO (CA-44, RN-20, RN-21, RN-33).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const marcar = (c: Cenario, reservaId: string, itemId: string, destino: string, fila = filaEspia()) =>
  marcarStatusDoItem(c.ctxEquipe, { reservaId, itemId, destino }, DEPOIS, { enfileirar: fila.enfileirar });

const convites = async (id: string) => (await mensagensDe(id)).filter((m) => m.tipo === 'convite_avaliacao');

async function reservaDeDois(c: Cenario) {
  const r = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
  await consentirConvite(r.id);
  return r;
}

describe('CA-44: convite só quando o derivado passa a concluido', () => {
  it('só X concluído → nenhum convite; Y concluído → 1 convite; alternar Y concluído ↔ não compareceu não gera outro', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);

    const r1 = await marcar(c, id, x, 'concluido');
    expect(r1).toEqual({ resultado: 'atualizada', itemId: x, status: 'concluido', statusReserva: 'confirmado', revisao: 0, mensagens: [] });
    expect(await convites(id)).toEqual([]);

    const fila = filaEspia();
    const r2 = await marcar(c, id, y, 'concluido', fila);
    expect(r2).toMatchObject({ resultado: 'atualizada', status: 'concluido', statusReserva: 'concluido', revisao: 0, mensagens: [{ estado: 'pendente' }] });
    expect(await convites(id)).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'pendente', reservaItemId: null }]);
    expect(fila.chaves()).toEqual([`${id}:convite_avaliacao:0`]);
    // A confirmação deixou de ser vigente (derivado ≠ confirmado) e é substituída.
    expect((await mensagensDe(id)).find((m) => m.tipo === 'confirmacao')).toMatchObject({ estado: 'substituida' });

    // Y vira não compareceu: X segue concluído, derivado continua concluído, nada novo.
    expect(await marcar(c, id, y, 'nao_compareceu')).toMatchObject({ statusReserva: 'concluido', mensagens: [] });
    expect(await marcar(c, id, y, 'concluido')).toMatchObject({ statusReserva: 'concluido', mensagens: [] });
    expect(await convites(id)).toHaveLength(1);
    expect((await reservaDe(id)).revisao).toBe(0);
    await conferirDerivados(id);
  });

  it('último confirmado marcado não compareceu com um concluído → derivado concluido e convite', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    await marcar(c, id, x, 'concluido');
    expect(await marcar(c, id, y, 'nao_compareceu')).toMatchObject({ statusReserva: 'concluido', mensagens: [{ estado: 'pendente' }] });
    expect(await convites(id)).toHaveLength(1);
  });

  it('todos não compareceu → derivado nao_compareceu, sem convite; nao_compareceu → concluido de um item → convite (RN-33)', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    await marcar(c, id, x, 'nao_compareceu');
    expect(await marcar(c, id, y, 'nao_compareceu')).toMatchObject({ statusReserva: 'nao_compareceu', mensagens: [] });
    expect(await convites(id)).toEqual([]);
    expect(await marcar(c, id, x, 'concluido')).toMatchObject({ statusReserva: 'concluido', mensagens: [{ estado: 'pendente' }] });
    expect(await convites(id)).toHaveLength(1);
  });

  it('o único concluído vira não compareceu → derivado nao_compareceu e o convite pendente é substituído; voltar não reenvia', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await reservaDeDois(c);
    await marcar(c, id, x, 'concluido');
    await marcar(c, id, y, 'concluido');
    await marcar(c, id, x, 'nao_compareceu');
    expect(await marcar(c, id, y, 'nao_compareceu')).toMatchObject({ statusReserva: 'nao_compareceu' });
    expect(await convites(id)).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'substituida', reservaItemId: null }]);
    const fila = filaEspia();
    expect(await marcar(c, id, y, 'concluido', fila)).toMatchObject({ statusReserva: 'concluido' });
    expect(await convites(id)).toEqual([{ tipo: 'convite_avaliacao', revisao: 0, estado: 'substituida', reservaItemId: null }]);
    expect(fila.total()).toBe(0);
    await conferirDerivados(id);
  });

  it('RN-33: cancelar o último confirmado quando há item concluído → convite na mesma transação do cancelamento', async () => {
    const c = await criarCenario();
    const { id, itens: [x, y] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '15:00' }]);
    await consentirConvite(id);
    const agora = sp(DIA, '14:00'); // X já começou, Y ainda não terminou
    await marcarStatusDoItem(c.ctxEquipe, { reservaId: id, itemId: x, destino: 'concluido' }, agora, { enfileirar: filaEspia().enfileirar });
    const r = await cancelarItem(c.ctxEquipe, { reservaId: id, itemId: y }, agora, { enfileirar: filaEspia().enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', statusReserva: 'concluido', revisao: 1 });
    if (r.resultado !== 'atualizada') return;
    expect(r.mensagens).toHaveLength(2);
    expect(await mensagensDe(id)).toEqual([
      { tipo: 'confirmacao', revisao: 0, estado: 'substituida', reservaItemId: null },
      { tipo: 'cancelamento', revisao: 1, estado: 'pendente', reservaItemId: y },
      { tipo: 'convite_avaliacao', revisao: 0, estado: 'pendente', reservaItemId: null },
    ]);
    expect(await itemDe(x)).toMatchObject({ status: 'concluido' });
    await conferirDerivados(id);
  });

  it('sem consentimento do convite: nasce nao_enviada e não é enfileirado', async () => {
    const c = await criarCenario();
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }]);
    const fila = filaEspia();
    expect(await marcar(c, id, x, 'concluido', fila)).toMatchObject({ statusReserva: 'concluido', mensagens: [{ estado: 'nao_enviada' }] });
    expect(fila.total()).toBe(0);
  });
});
