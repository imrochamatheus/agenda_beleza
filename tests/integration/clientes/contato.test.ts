import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerContatoDaCliente } from '@/server/clientes/leitura';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';
import { criarTenantContext } from '@/server/tenant/context';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, ctxDoGestor, ctxDoProfissional, inserirCliente, inserirReservaComPreco } from './apoio';

// D-022 T-5: CA-14 — contato da cliente para o profissional restrito às próprias reservas.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});

describe('CA-14: lerContatoDaCliente', () => {
  it('P1 (com reserva da cliente, em qualquer status) recebe nome e telefone', async () => {
    const r = await lerContatoDaCliente(ctxDoProfissional(a), a.clientes.ativaId);
    expect(r).toEqual({ id: a.clientes.ativaId, nome: a.clientes.nomeAtiva, telefoneE164: a.clientes.telefoneAtiva, anonimizada: false });

    const so = await inserirCliente(c, a.salaoId, 'Só Cancelada');
    await inserirReservaComPreco(c, {
      salaoId: a.salaoId,
      profissionalId: a.profissional.profissionalId,
      clienteId: so,
      inicio: new Date('2027-03-01T13:00:00Z'),
      status: 'cancelado',
      itens: [{ servicoId: a.servicos.ativos[0], precoCentavos: 1000, duracaoMin: 30 }],
    });
    expect(await lerContatoDaCliente(ctxDoProfissional(a), so)).toMatchObject({ nome: 'Só Cancelada', anonimizada: false });
  });

  it('P2 sem reserva da cliente, profissional de outro salão e inexistente: NaoEncontrado igual', async () => {
    const cliente = await inserirCliente(c, a.salaoId, 'Sem Reserva');
    // O gestor tem perfil de profissional: como "profissional" de contexto, não tem reserva com ela.
    const p2 = criarTenantContext({
      usuarioId: a.gestor.usuarioId,
      papel: 'profissional',
      salaoId: a.salaoId,
      profissionalId: a.gestor.profissionalId,
    });
    await expect(lerContatoDaCliente(p2, a.clientes.ativaId)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerContatoDaCliente(ctxDoProfissional(a), cliente)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerContatoDaCliente(ctxDoProfissional(b), a.clientes.ativaId)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerContatoDaCliente(ctxDoProfissional(a), UUID_INEXISTENTE)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerContatoDaCliente(ctxDoProfissional(a), 'nao-uuid')).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('gestor: qualquer cliente do salão; anonimizada vem com nome/telefone null; outro salão e id inválido → NaoEncontrado', async () => {
    const g = ctxDoGestor(a);
    expect(await lerContatoDaCliente(g, a.clientes.ativaId)).toMatchObject({ nome: a.clientes.nomeAtiva, anonimizada: false });
    expect(await lerContatoDaCliente(g, a.clientes.anonimizadaId)).toEqual({
      id: a.clientes.anonimizadaId,
      nome: null,
      telefoneE164: null,
      anonimizada: true,
    });
    await expect(lerContatoDaCliente(g, b.clientes.ativaId)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerContatoDaCliente(g, 7)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('profissional sem perfil vinculado: AcessoNegado', async () => {
    const sem = criarTenantContext({ usuarioId: a.profissional.usuarioId, papel: 'profissional', salaoId: a.salaoId, profissionalId: null });
    await expect(lerContatoDaCliente(sem, a.clientes.ativaId)).rejects.toBeInstanceOf(AcessoNegado);
  });
});
