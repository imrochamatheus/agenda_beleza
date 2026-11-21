import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registrarConsentimentoDaReserva } from '@/server/consentimento/servico';
import { criarRepos } from '@/server/repos';
import { obterPrisma } from '@/server/repos/db';
import { emTransacao } from '@/server/repos/transacao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { AGORA, ctxPublico, inserirCliente, linhasDe } from './apoio';

// D-023 T-5: CA-12 (RN-9). O consentimento vive e morre com a transação da reserva.

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

const aceites = { mensagensReserva: true, conviteAvaliacao: true };

describe('CA-12: atomicidade com a transação do chamador', () => {
  it('rollback forçado depois do registro não deixa linha', async () => {
    const clienteId = await inserirCliente(c, s.salaoId, 'Desfeita');
    await expect(
      emTransacao(async (r) => {
        const res = await registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites, origem: 'publico', agora: AGORA }, r);
        expect(res.ok && res.registrados).toHaveLength(2);
        throw new Error('falha posterior do chamador');
      }),
    ).rejects.toThrow('falha posterior do chamador');
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });

  it('violação de reserva_sem_sobreposicao (23P01) depois do registro desfaz o consentimento', async () => {
    const clienteId = await inserirCliente(c, s.salaoId, 'Sem Horario');
    const erro = await obterPrisma()
      .$transaction(async (tx) => {
        await registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites, origem: 'publico', agora: AGORA }, criarRepos(tx));
        // Reserva no mesmo profissional e horário da reserva da fábrica.
        await tx.$executeRaw`
          INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
          VALUES (${s.salaoId}::uuid, ${s.profissional.profissionalId}::uuid, ${clienteId}::uuid,
                  ${s.reserva.inicio}, ${s.reserva.fim}, ${s.reserva.fim}, 'confirmado', 'publico')`;
      })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(erro).not.toBeNull();
    expect(String((erro as Error).message)).toContain('reserva_sem_sobreposicao');
    expect(await linhasDe(c, clienteId)).toEqual([]);
  });

  it('transação confirmada: linhas e cliente aparecem juntas', async () => {
    const clienteId = await emTransacao(async (r) => {
      const { cliente } = await r.clientes.upsert(ctxPublico(s), { nome: 'Nova Juntas', telefoneE164: '+5511955550001' });
      const res = await registrarConsentimentoDaReserva(ctxPublico(s), { clienteId: cliente.id, aceites, origem: 'publico', agora: AGORA }, r);
      expect(res.ok).toBe(true);
      return cliente.id;
    });
    expect((await linhasDe(c, clienteId)).map((l) => l.finalidade).sort()).toEqual(['convite_avaliacao', 'mensagens_reserva']);
    const { rows } = await c.query('SELECT 1 FROM cliente WHERE id = $1', [clienteId]);
    expect(rows).toHaveLength(1);
  });

  it('sem executor do chamador: todas as linhas ou nenhuma (cliente inexistente na 1ª → nada)', async () => {
    const antes = await c.query('SELECT count(*)::int AS n FROM consentimento WHERE salao_id = $1', [s.salaoId]);
    await expect(
      registrarConsentimentoDaReserva(ctxPublico(s), { clienteId: '00000000-0000-4000-8000-000000000000', aceites, origem: 'publico', agora: AGORA }),
    ).rejects.toMatchObject({ name: 'NaoEncontrado' });
    const depois = await c.query('SELECT count(*)::int AS n FROM consentimento WHERE salao_id = $1', [s.salaoId]);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  });
});
