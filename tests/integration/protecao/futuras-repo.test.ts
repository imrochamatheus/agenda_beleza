import { describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { obterPrisma } from '@/server/repos/db';

import { AGORA, DIA, criarCenarioReserva, sp } from '../../support/reservas';
import { inserirReservaDireta } from '../../support/reservas';

// D-027: `contarFuturasDaCliente` em isolamento (escopo por salão, status, instante, chave ignorada).
const hora = (h: number) => sp(DIA, `${String(h).padStart(2, '0')}:00`);

describe('RepoReserva.contarFuturasDaCliente', () => {
  it('conta só confirmadas futuras da cliente neste salão; ignora a chave; outro salão ou id inválido → 0', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const a = await inserirReservaDireta(c, { inicio: hora(10), fim: hora(11) });
    const clienteId = (await repos().reservas.buscarPorId(c.ctxSistema, a)).clienteId;
    expect(await repos().reservas.contarFuturasDaCliente(c.ctxSistema, { clienteId, agora: AGORA, ignorarChave: null })).toBe(1);
    // Outro salão com o id da cliente: não existe lá.
    expect(await repos().reservas.contarFuturasDaCliente(outro.ctxSistema, { clienteId, agora: AGORA, ignorarChave: null })).toBe(0);
    expect(await repos().reservas.contarFuturasDaCliente(c.ctxSistema, { clienteId: 'nao-uuid', agora: AGORA, ignorarChave: null })).toBe(0);
    // Ignora a chave da própria requisição.
    const chave = '11111111-1111-4111-8111-111111111111';
    await obterPrisma().reserva.update({ where: { id: a }, data: { chaveRequisicao: chave } });
    expect(await repos().reservas.contarFuturasDaCliente(c.ctxSistema, { clienteId, agora: AGORA, ignorarChave: chave })).toBe(0);
    // Instante: reserva que já começou não é futura.
    expect(await repos().reservas.contarFuturasDaCliente(c.ctxSistema, { clienteId, agora: hora(10), ignorarChave: null })).toBe(0);
  });
});
