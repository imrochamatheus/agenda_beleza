import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import type { ResultadoCriarReserva } from '@/server/reservas/tipos';

import { DIA, contarLinhas, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

// D-025 T-6b: CA-5, CA-14, CA-24 (idempotência por chave de requisição).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const dispara = (cen: CenarioReserva, sobre: Parameters<typeof entradaReserva>[1]) =>
  criarReserva(cen.ctxSistema, entradaReserva(cen, sobre), { enfileirar });
const idDe = (r: ResultadoCriarReserva) => (r.resultado === 'criada' || r.resultado === 'repetida' ? r.reserva.id : null);

describe('CA-5: mesma chave', () => {
  it('em sequência: criada e repetida (sem revalidar), mesmo id, 1 de cada linha', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const chaveRequisicao = randomUUID();
    const sobre = { chaveRequisicao, cliente: { nome: 'Ana', telefone: telefoneNovo() } };
    const a = await dispara(cen, sobre);
    const b = await dispara(cen, sobre);
    expect(a.resultado).toBe('criada');
    expect(b.resultado).toBe('repetida');
    expect(idDe(b)).toBe(idDe(a));
    expect(b.resultado === 'repetida' && b.reserva.itens).toHaveLength(1);
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 1, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });

  it('em paralelo (2): uma criada e uma repetida, mesmo id', async () => {
    const cen = await criarCenarioReserva();
    const sobre = { chaveRequisicao: randomUUID(), cliente: { nome: 'Ana', telefone: telefoneNovo() } };
    const rs = await Promise.all([dispara(cen, sobre), dispara(cen, sobre)]);
    expect(rs.map((r) => r.resultado).sort()).toEqual(['criada', 'repetida']);
    expect(idDe(rs[0])).toBe(idDe(rs[1]));
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(1);
  });

  it('sem chave os envios iguais não são deduplicados: o segundo é horario_indisponivel', async () => {
    const cen = await criarCenarioReserva();
    const sobre = { cliente: { nome: 'Ana', telefone: telefoneNovo() } };
    expect((await dispara(cen, sobre)).resultado).toBe('criada');
    expect(await dispara(cen, sobre)).toEqual({ resultado: 'horario_indisponivel', causa: 'revalidacao' });
  });

  it('chaves distintas no mesmo horário: 1 criada, 1 horario_indisponivel', async () => {
    const cen = await criarCenarioReserva();
    const rs = await Promise.all([dispara(cen, { chaveRequisicao: randomUUID() }), dispara(cen, { chaveRequisicao: randomUUID() })]);
    expect(rs.map((r) => r.resultado).sort()).toEqual(['criada', 'horario_indisponivel']);
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(1);
  });
});

describe('CA-14: chave reutilizada', () => {
  it('outro horário, profissional ou conjunto de serviços: chave_reutilizada, sem gravar nem expor', async () => {
    const cen = await criarCenarioReserva();
    const chaveRequisicao = randomUUID();
    const a = await dispara(cen, { chaveRequisicao });
    expect(a.resultado).toBe('criada');
    const antes = await contarLinhas(cen.s.salaoId);
    const variantes = [
      { inicio: sp(DIA, '12:00') },
      { profissionalId: cen.bia },
      { servicoIds: [cen.A, cen.B] },
    ];
    for (const v of variantes) {
      const r = await dispara(cen, { chaveRequisicao, ...v });
      expect(r).toEqual({ resultado: 'chave_reutilizada' });
    }
    expect(await contarLinhas(cen.s.salaoId)).toEqual(antes);
  });

  it('chave que não é UUID → invalido/chave', async () => {
    const cen = await criarCenarioReserva();
    const r = await dispara(cen, { chaveRequisicao: 'abc' });
    expect(r.resultado).toBe('invalido');
    expect(r.resultado === 'invalido' && Object.keys(r.erros)).toEqual(['chave']);
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(0);
  });
});

describe('CA-24: 10 requisições com a mesma chave em paralelo', () => {
  it('1 criada, 9 repetidas, todas com o mesmo id; 1 reserva, 1 mensagem', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const sobre = { chaveRequisicao: randomUUID(), cliente: { nome: 'Ana', telefone: telefoneNovo() } };
    const rs = await Promise.all(Array.from({ length: 10 }, () => dispara(cen, sobre)));
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'repetida')).toHaveLength(9);
    expect(new Set(rs.map(idDe)).size).toBe(1);
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 1, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });
});
