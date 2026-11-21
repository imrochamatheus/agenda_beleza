import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';
import { repos } from '@/server/repos';

import { DIA, contarLinhas, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

// D-025 T-6c: CA-10 (ids de outro salão ou malformados) e CA-13 (isolamento entre salões).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const INEXISTENTE = '00000000-0000-4000-8000-000000000000';

async function fotografia(salaoId: string): Promise<string> {
  const db = obterPrisma();
  const [reservas, itens, clientes, mensagens, consentimentos, servicos, profissionais] = await Promise.all([
    db.reserva.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.reservaItem.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.cliente.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.mensagem.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.consentimento.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.servico.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
    db.profissional.findMany({ where: { salaoId }, orderBy: { id: 'asc' } }),
  ]);
  return JSON.stringify({ reservas, itens, clientes, mensagens, consentimentos, servicos, profissionais });
}

describe('CA-10: ids de outro salão, inexistentes e malformados', () => {
  it('profissional e serviços de B no contexto de A: o mesmo resultado do inexistente e do malformado, sem gravar em nenhum', async () => {
    const a = await criarCenarioReserva();
    const b = await criarCenarioReserva();
    const antesA = await fotografia(a.s.salaoId);
    const antesB = await fotografia(b.s.salaoId);
    const tentar = (sobre: Parameters<typeof entradaReserva>[1]) => criarReserva(a.ctxSistema, entradaReserva(a, sobre), { enfileirar });

    const profDeB = await tentar({ profissionalId: b.ana });
    expect(profDeB).toEqual({ resultado: 'profissional_indisponivel' });
    expect(await tentar({ profissionalId: INEXISTENTE })).toEqual(profDeB);
    expect(await tentar({ profissionalId: 'malformado' })).toEqual(profDeB);

    const servDeB = await tentar({ servicoIds: [b.A] });
    expect(servDeB).toEqual({ resultado: 'servico_indisponivel' });
    expect(await tentar({ servicoIds: [INEXISTENTE] })).toEqual(servDeB);
    expect(await tentar({ servicoIds: ['malformado'] })).toEqual(servDeB);
    expect(await tentar({ servicoIds: [a.A, b.B] })).toEqual(servDeB);

    expect(await fotografia(a.s.salaoId)).toBe(antesA);
    expect(await fotografia(b.s.salaoId)).toBe(antesB);
  });

  it('o contexto de B nunca vê a reserva criada em A, e a chave de A não é vista por B', async () => {
    const a = await criarCenarioReserva();
    const b = await criarCenarioReserva();
    const chaveRequisicao = '7f1c2a3e-8c1d-4b7a-9d11-0a1b2c3d4e5f';
    const ra = await criarReserva(a.ctxSistema, entradaReserva(a, { chaveRequisicao }), { enfileirar });
    expect(ra.resultado).toBe('criada');
    const doDia = { de: sp(DIA, '00:00'), ate: sp(DIA, '23:59') };
    expect(await repos().reservas.listarPorPeriodo(b.ctxEquipe, doDia)).toEqual([]);
    expect(await repos().reservas.buscarPorChave(b.ctxSistema, chaveRequisicao)).toBeNull();
    expect(await repos().reservas.listarPorPeriodo(a.ctxEquipe, doDia)).toHaveLength(1);
  });
});

describe('CA-13: clientes por salão', () => {
  it('o mesmo telefone em dois salões gera clientes distintas', async () => {
    const a = await criarCenarioReserva();
    const b = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const ra = await criarReserva(a.ctxSistema, entradaReserva(a, { cliente: { nome: 'Ana', telefone } }), { enfileirar });
    const rb = await criarReserva(b.ctxSistema, entradaReserva(b, { cliente: { nome: 'Ana', telefone } }), { enfileirar });
    expect([ra.resultado, rb.resultado]).toEqual(['criada', 'criada']);
    if (ra.resultado !== 'criada' || rb.resultado !== 'criada') return;
    expect(ra.reserva.clienteId).not.toBe(rb.reserva.clienteId);
    expect(await contarLinhas(a.s.salaoId)).toMatchObject({ reserva: 1, mensagem: 1 });
    expect(await contarLinhas(b.s.salaoId)).toMatchObject({ reserva: 1, mensagem: 1 });
  });
});
