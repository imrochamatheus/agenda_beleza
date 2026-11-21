import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentimentoVigente, temConsentimentoDeMensagens } from '@/server/consentimento/leitura';
import { registrarConsentimento } from '@/server/consentimento/servico';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, telefoneNovo } from '../../support/sql';

import { AGORA, contarDoSalao, ctxDoGestor, ctxPublico, fotografiaDoSalao } from './apoio';

// D-023 T-5: CA-10, isolamento entre salões.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
const TELEFONE = telefoneNovo();

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
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

describe('CA-10: a cliente de outro salão é NaoEncontrado', () => {
  it('registrar e consultar por S2 (gestor ou sistema) não toca as linhas de S1', async () => {
    const c1 = a.clientes.ativaId;
    await registrarConsentimento(ctxPublico(a), { clienteId: c1, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
    const antesA = await fotografiaDoSalao(c, a.salaoId);
    const antesB = await contarDoSalao(c, b.salaoId);
    for (const ctx of [ctxDoGestor(b), ctxPublico(b)]) {
      const finalidade = 'mensagens_reserva' as const;
      const origem = ctx.tipo === 'tenant' ? ('equipe' as const) : ('publico' as const);
      await expect(registrarConsentimento(ctx, { clienteId: c1, finalidade, origem, agora: AGORA })).rejects.toMatchObject({ name: 'NaoEncontrado' });
      await expect(consentimentoVigente(ctx, c1, finalidade)).rejects.toMatchObject({ name: 'NaoEncontrado' });
      await expect(temConsentimentoDeMensagens(ctx, c1)).rejects.toMatchObject({ name: 'NaoEncontrado' });
    }
    expect(await fotografiaDoSalao(c, a.salaoId)).toEqual(antesA);
    expect(await contarDoSalao(c, b.salaoId)).toBe(antesB);
  });

  it('com o mesmo telefone nos dois salões, a vigente de S2 não enxerga as linhas de S1', async () => {
    const { rows: ca } = await c.query<{ id: string }>("INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Igual', $2) RETURNING id::text AS id", [a.salaoId, TELEFONE]);
    const { rows: cb } = await c.query<{ id: string }>("INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Igual', $2) RETURNING id::text AS id", [b.salaoId, TELEFONE]);
    await registrarConsentimento(ctxPublico(a), { clienteId: ca[0].id, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
    expect(await consentimentoVigente(ctxPublico(b), cb[0].id, 'mensagens_reserva')).toBeNull();
    expect(await temConsentimentoDeMensagens(ctxPublico(a), ca[0].id)).toBe(true);
    expect(await temConsentimentoDeMensagens(ctxPublico(b), cb[0].id)).toBe(false);
  });

  it('id que não é UUID e cliente inexistente: NaoEncontrado', async () => {
    await expect(consentimentoVigente(ctxPublico(a), 'x', 'mensagens_reserva')).rejects.toMatchObject({ name: 'NaoEncontrado' });
    await expect(
      registrarConsentimento(ctxPublico(a), { clienteId: '00000000-0000-4000-8000-000000000000', finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA }),
    ).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });
});
