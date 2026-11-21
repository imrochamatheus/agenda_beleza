import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentimentoVigente, temConsentimentoDeMensagens } from '@/server/consentimento/leitura';
import { registrarConsentimento, registrarConsentimentoDaReserva } from '@/server/consentimento/servico';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { AGORA, anonimizarPorSql, ctxPublico, inserirCliente, linhasDe } from './apoio';

// D-023 T-5: CA-11 (RN-12).

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CA-11: cliente anonimizada', () => {
  it('a fábrica de anonimizada recusa o registro sem linha', async () => {
    const id = s.clientes.anonimizadaId;
    await expect(registrarConsentimento(ctxPublico(s), { clienteId: id, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA })).rejects.toMatchObject({ name: 'NaoEncontrado' });
    await expect(registrarConsentimentoDaReserva(ctxPublico(s), { clienteId: id, aceites: { mensagensReserva: true }, origem: 'publico', agora: AGORA })).rejects.toMatchObject({ name: 'NaoEncontrado' });
    expect(await linhasDe(c, id)).toEqual([]);
  });

  it('depois de anonimizar, as linhas antigas permanecem mas a vigente é null', async () => {
    const id = await inserirCliente(c, s.salaoId, 'Vai Sair');
    await registrarConsentimento(ctxPublico(s), { clienteId: id, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
    expect(await temConsentimentoDeMensagens(ctxPublico(s), id)).toBe(true);
    await anonimizarPorSql(c, id);
    expect(await consentimentoVigente(ctxPublico(s), id, 'mensagens_reserva')).toBeNull();
    expect(await temConsentimentoDeMensagens(ctxPublico(s), id)).toBe(false);
    expect(await linhasDe(c, id)).toHaveLength(1);
    await expect(registrarConsentimento(ctxPublico(s), { clienteId: id, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA })).rejects.toMatchObject({ name: 'NaoEncontrado' });
    expect(await linhasDe(c, id)).toHaveLength(1);
  });
});
