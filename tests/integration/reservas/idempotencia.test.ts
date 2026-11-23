import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import type { ResultadoCriarReserva } from '@/server/reservas/tipos';

import { DIA, conferirDerivados, contarLinhas, criarCenarioReserva, entradaReserva, sp } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

import { item, jornadaDaBia, revalidacao, um } from './apoio-itens';

// D-025 T-6b: CA-5, CA-14, CA-24 (idempotência por chave de requisição); D-050 T-5: CA-11 (RN-14, a chave
// identifica a reserva inteira com N itens).

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
    expect(await dispara(cen, sobre)).toEqual(revalidacao());
  });

  it('chaves distintas no mesmo horário: 1 criada, 1 horario_indisponivel', async () => {
    const cen = await criarCenarioReserva();
    const rs = await Promise.all([dispara(cen, { chaveRequisicao: randomUUID() }), dispara(cen, { chaveRequisicao: randomUUID() })]);
    expect(rs.map((r) => r.resultado).sort()).toEqual(['criada', 'horario_indisponivel']);
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(1);
  });
});

describe('CA-14: chave reutilizada', () => {
  it('outro horário, profissional ou conjunto de itens: chave_reutilizada, sem gravar nem expor', async () => {
    const cen = await criarCenarioReserva();
    const chaveRequisicao = randomUUID();
    const a = await dispara(cen, { chaveRequisicao });
    expect(a.resultado).toBe('criada');
    const antes = await contarLinhas(cen.s.salaoId);
    const variantes = [
      um(cen, sp(DIA, '12:00')),
      um(cen, sp(DIA, '10:00'), { profissionalId: cen.bia }),
      { itens: [item(cen, sp(DIA, '10:00')), item(cen, sp(DIA, '11:00'), { servicoId: cen.B })] },
      um(cen, sp(DIA, '10:00'), { servicoId: cen.B }),
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

describe('D-050 CA-11 (RN-14): a chave identifica a reserva inteira com N itens', () => {
  const doisItens = (cen: CenarioReserva) => [item(cen, sp(DIA, '10:00'), { profissionalId: cen.bia }), item(cen, sp(DIA, '11:00'), { servicoId: cen.B })];

  it('10 envios em paralelo do mesmo formulário de 2 itens: 1 reserva com 2 itens, 9 repetidas com os mesmos itens, sem 23505', async () => {
    const cen = await criarCenarioReserva();
    await jornadaDaBia(cen);
    const antes = await contarLinhas(cen.s.salaoId);
    const sobre = { chaveRequisicao: randomUUID(), cliente: { nome: 'Ana', telefone: telefoneNovo() }, itens: doisItens(cen) };
    const rs = await Promise.all(Array.from({ length: 10 }, () => dispara(cen, sobre)));
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'repetida')).toHaveLength(9);
    expect(new Set(rs.map(idDe)).size).toBe(1);
    const criada = rs.find((r) => r.resultado === 'criada');
    if (criada?.resultado !== 'criada') throw new Error('esperava criada');
    for (const r of rs) {
      if (r.resultado !== 'repetida') continue;
      expect(r.reserva.itens.map((i) => [i.id, i.servicoId, i.profissionalId, i.inicio, i.fim])).toEqual(
        criada.reserva.itens.map((i) => [i.id, i.servicoId, i.profissionalId, i.inicio, i.fim]),
      );
    }
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 2, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
    await conferirDerivados(criada.reserva.id);
  });

  it('a mesma chave com os itens em outra ordem é a mesma requisição (conjunto); com um item a menos é reutilizada', async () => {
    const cen = await criarCenarioReserva();
    await jornadaDaBia(cen);
    const chaveRequisicao = randomUUID();
    const a = await dispara(cen, { chaveRequisicao, itens: doisItens(cen) });
    expect(a.resultado).toBe('criada');
    const b = await dispara(cen, { chaveRequisicao, itens: [...doisItens(cen)].reverse() });
    expect(b.resultado).toBe('repetida');
    expect(idDe(b)).toBe(idDe(a));
    expect(await dispara(cen, { chaveRequisicao, itens: [doisItens(cen)[0]] })).toEqual({ resultado: 'chave_reutilizada' });
  });
});
