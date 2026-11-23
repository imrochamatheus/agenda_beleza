import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { remarcarItem } from '@/server/reservas/remarcar';

import { AGORA, conferirDerivados, criarCenario, criarComItens, filaEspia, itemDe } from './apoio';

// D-050 T-6: a remarcação converte data + hora LOCAIS do salão (fuso.ts) e compara datas no fuso do salão,
// nunca no do processo. Rodar com TZ=UTC e TZ=America/Sao_Paulo (laço do CLAUDE.md).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('remarcar item no fuso do salão (America/Manaus, UTC−4)', () => {
  it('22:30 local de 01/12 é 02:30Z de 02/12 e continua na MESMA data local dos outros itens', async () => {
    const c = await criarCenario({ fuso: 'America/Manaus' });
    // sp(…,'10:00') = 13:00Z = 09:00 em Manaus; Y às 10:00 em Manaus.
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '10:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    const r = await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '22:30', confirmarEncaixe: 'on' }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect(r).toMatchObject({ resultado: 'atualizada', encaixe: true });
    expect((await itemDe(x)).inicio).toEqual(new Date('2026-12-02T02:30:00Z'));
    await conferirDerivados(id);
  });

  it('a data local seguinte (02/12) com outro item no dia 01/12 → data_diferente, mesmo sendo o mesmo dia em UTC', async () => {
    const c = await criarCenario({ fuso: 'America/Manaus' });
    const { id, itens: [x] } = await criarComItens(c, [{ hora: '22:00' }, { servicoId: c.C, profissionalId: c.bia, hora: '11:00' }]);
    // X está às 21:00 de 01/12 em Manaus (01:00Z de 02/12): a data local do item é 01/12.
    expect(await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, data: '2026-12-02', hora: '00:30' }, AGORA, { enfileirar: filaEspia().enfileirar })).toEqual({
      resultado: 'recusado',
      motivo: 'data_diferente',
    });
    // Sem data: mantém 01/12 local.
    const r = await remarcarItem(c.ctxEquipe, { reservaId: id, itemId: x, hora: '20:00', confirmarEncaixe: 'on' }, AGORA, { enfileirar: filaEspia().enfileirar });
    expect(r.resultado).toBe('atualizada');
    expect((await itemDe(x)).inicio).toEqual(new Date('2026-12-02T00:00:00Z'));
  });
});
