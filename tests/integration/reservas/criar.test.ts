import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ehConflitoDeSobreposicao } from '@/server/reservas/erros-banco';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';
import { criarPublicoContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import {
  AGORA,
  DIA,
  MIN_MS,
  conferirDerivados,
  contarLinhas,
  criarCenarioReserva,
  entradaReserva,
  sp,
} from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

import { item, jornadaDaBia, ocupar, revalidacao, um } from './apoio-itens';

// D-025 T-6a: CA-1, CA-11, CA-12, CA-13, CA-21, CA-27 contra o PostgreSQL real; D-050 T-5: N itens.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();

describe('CA-1 / D-050 CA-6: itens com profissional e horário próprios, snapshot por item', () => {
  it('A (R$ 50, 30 min) com a Ana às 10:00 e B (R$ 70, 45 min) com a Ana às 11:00: 1 reserva, 2 itens, derivados coerentes', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { itens: [item(c, sp(DIA, '11:00'), { servicoId: c.B }), item(c, sp(DIA, '10:00'))] }),
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    const reserva = await db().reserva.findUniqueOrThrow({ where: { id: r.reserva.id }, include: { itens: { orderBy: { ordem: 'asc' } } } });
    expect(reserva).toMatchObject({ status: 'confirmado', revisao: 0, canceladaEm: null, origem: 'equipe' });
    expect(reserva.inicio).toEqual(sp(DIA, '10:00'));
    expect(reserva.fim).toEqual(sp(DIA, '11:45'));
    expect(reserva.itens.map((i) => [i.servicoId, i.profissionalId, i.ordem, i.inicio, i.fim, i.ocupadoAte, i.status, i.encaixe, i.revisao, i.precoCentavos, i.duracaoMin])).toEqual([
      [c.B, c.ana, 0, sp(DIA, '11:00'), sp(DIA, '11:45'), sp(DIA, '11:45'), 'confirmado', false, 0, 7000, 45],
      [c.A, c.ana, 1, sp(DIA, '10:00'), sp(DIA, '10:30'), sp(DIA, '10:30'), 'confirmado', false, 0, 5000, 30],
    ]);
    // O resultado lista os itens por início, com o id gravado.
    expect(r.reserva.itens.map((i) => [i.servicoId, i.ordem, i.inicio, i.fim])).toEqual([
      [c.A, 1, sp(DIA, '10:00'), sp(DIA, '10:30')],
      [c.B, 0, sp(DIA, '11:00'), sp(DIA, '11:45')],
    ]);
    expect(r.reserva.itens.map((i) => i.id).sort()).toEqual(reserva.itens.map((i) => i.id).sort());
    expect(r.reserva).toMatchObject({ inicio: sp(DIA, '10:00'), fim: sp(DIA, '11:45'), status: 'confirmado', revisao: 0 });
    expect(r.confirmacao.estado).toBe('pendente');
    await conferirDerivados(r.reserva.id);
  });

  it('dois profissionais na mesma reserva, itens adjacentes (RN-8 semiaberto): A com a Bia 10:00–10:30 e B com a Ana às 10:30', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    const r = await criarReserva(
      c.ctxSistema,
      entradaReserva(c, { itens: [item(c, sp(DIA, '10:00'), { profissionalId: c.bia }), item(c, sp(DIA, '10:30'), { servicoId: c.B })] }),
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => [i.profissionalId, i.inicio])).toEqual([
      [c.bia, sp(DIA, '10:00')],
      [c.ana, sp(DIA, '10:30')],
    ]);
    expect(await db().reservaItem.count({ where: { reservaId: r.reserva.id } })).toBe(2);
    await conferirDerivados(r.reserva.id);
  });

  it('intervalo de 10 min: ocupado_ate = fim + 10 em cada item; fim da reserva = maior fim', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 10 });
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { itens: [item(c, sp(DIA, '10:00')), item(c, sp(DIA, '10:45'), { servicoId: c.B })] }));
    expect(r.resultado).toBe('criada');
    const linha = await db().reserva.findFirstOrThrow({ where: { salaoId: c.s.salaoId }, include: { itens: { orderBy: { inicio: 'asc' } } } });
    expect(linha.fim).toEqual(sp(DIA, '11:30'));
    expect(linha.itens.map((i) => [i.fim, i.ocupadoAte])).toEqual([
      [sp(DIA, '10:30'), sp(DIA, '10:40')],
      [sp(DIA, '11:30'), sp(DIA, '11:40')],
    ]);
  });

  it('alterar o serviço depois não altera o snapshot do item', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c));
    expect(r.resultado).toBe('criada');
    await db().servico.update({ where: { id: c.A }, data: { precoCentavos: 9900, duracaoMin: 60 } });
    const item0 = await db().reservaItem.findFirstOrThrow({ where: { salaoId: c.s.salaoId } });
    expect([item0.precoCentavos, item0.duracaoMin]).toEqual([5000, 30]);
  });
});

describe('CA-11: consentimento gravado com a reserva', () => {
  it('público grava mensagens_reserva e convite_avaliacao (se marcado), origem publico', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxSistema, entradaReserva(c, { aceites: { mensagensReserva: true, conviteAvaliacao: true } }));
    expect(r.resultado).toBe('criada');
    const linhas = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId }, orderBy: { finalidade: 'asc' } });
    expect(linhas.map((l) => [l.finalidade, l.origem]).sort()).toEqual([
      ['convite_avaliacao', 'publico'],
      ['mensagens_reserva', 'publico'],
    ]);
  });

  it('equipe grava só mensagens_reserva (origem equipe) e ignora conviteAvaliacao', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { aceites: { mensagensReserva: true, conviteAvaliacao: true } }));
    expect(r.resultado).toBe('criada');
    const linhas = await db().consentimento.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas.map((l) => [l.finalidade, l.origem])).toEqual([['mensagens_reserva', 'equipe']]);
  });

  it('sem aceite: consentimento_ausente e nada é gravado', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxSistema, entradaReserva(c, { aceites: {} }));
    expect(r.resultado).toBe('consentimento_ausente');
    expect(await contarLinhas(c.s.salaoId)).toEqual({ reserva: 0, itens: 0, cliente: 2, consentimento: 0, mensagem: 0 });
  });
});

describe('CA-12: mensagem de confirmação e fila depois do commit', () => {
  it('registro pendente com o telefone; enfileirar só depois do commit', async () => {
    const c = await criarCenarioReserva();
    const telefone = '(11) 98888-7777';
    const visto: { reservas: number; mensagens: number }[] = [];
    const enfileirar = vi.fn(async () => {
      visto.push({
        reservas: await db().reserva.count({ where: { salaoId: c.s.salaoId } }),
        mensagens: await db().mensagem.count({ where: { salaoId: c.s.salaoId } }),
      });
      return { criado: true as const, id: 'job' };
    });
    const r = await criarReserva(c.ctxSistema, entradaReserva(c, { cliente: { nome: 'Ana', telefone } }), { enfileirar });
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(visto).toEqual([{ reservas: 1, mensagens: 1 }]);
    const m = await db().mensagem.findFirstOrThrow({ where: { reservaId: r.reserva.id } });
    expect(m).toMatchObject({ tipo: 'confirmacao', revisao: 0, estado: 'pendente', destinatarioE164: '+5511988887777' });
    expect(r.confirmacao.mensagemId).toBe(m.id);
    expect(enfileirar).toHaveBeenCalledWith('whatsapp-reserva', { mensagemId: m.id }, { chave: `${r.reserva.id}:confirmacao:0` });
  });

  it('rollback (horário ocupado) não enfileira', async () => {
    const c = await criarCenarioReserva();
    await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    const enfileirar = vi.fn(async () => ({ criado: true as const, id: 'job' }));
    const r = await criarReserva(c.ctxSistema, entradaReserva(c), { enfileirar });
    expect(r).toEqual(revalidacao());
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('cliente com consentimento anterior e nova reserva: nova mensagem (revisão 0 de outra reserva)', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const a = await criarReserva(c.ctxSistema, entradaReserva(c, { cliente: { nome: 'Ana', telefone } }));
    const b = await criarReserva(c.ctxSistema, entradaReserva(c, { cliente: { nome: 'Ana', telefone }, ...um(c, sp(DIA, '12:00')) }));
    expect([a.resultado, b.resultado]).toEqual(['criada', 'criada']);
    const m = await db().mensagem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(m).toHaveLength(2);
    expect(new Set(m.map((x) => x.reservaId)).size).toBe(2);
    expect(m.every((x) => x.revisao === 0 && x.tipo === 'confirmacao')).toBe(true);
    expect(await db().cliente.count({ where: { salaoId: c.s.salaoId, telefoneE164: { not: null } } })).toBe(2);
  });
});

describe('CA-13: origem e isolamento', () => {
  it('equipe → equipe; sistema → publico; contexto público lança sem gravar', async () => {
    const c = await criarCenarioReserva();
    const eq = await criarReserva(c.ctxEquipe, entradaReserva(c));
    const pu = await criarReserva(c.ctxSistema, entradaReserva(c, um(c, sp(DIA, '12:00'))));
    expect(eq.resultado === 'criada' && eq.reserva.origem).toBe('equipe');
    expect(pu.resultado === 'criada' && pu.reserva.origem).toBe('publico');
    const antes = await contarLinhas(c.s.salaoId);
    const publico = criarPublicoContext(c.s.salaoId, c.s.slugAtual) as unknown as ContextoEscopado;
    await expect(criarReserva(publico, entradaReserva(c, um(c, sp(DIA, '14:00'))))).rejects.toThrow();
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('a mesma chave em salões diferentes cria duas reservas independentes', async () => {
    const x = await criarCenarioReserva();
    const y = await criarCenarioReserva();
    const chave = '5f1c2a3e-8c1d-4b7a-9d11-0a1b2c3d4e5f';
    const rx = await criarReserva(x.ctxSistema, entradaReserva(x, { chaveRequisicao: chave }));
    const ry = await criarReserva(y.ctxSistema, entradaReserva(y, { chaveRequisicao: chave }));
    expect([rx.resultado, ry.resultado]).toEqual(['criada', 'criada']);
    expect(rx.resultado === 'criada' && ry.resultado === 'criada' && rx.reserva.id !== ry.reserva.id).toBe(true);
  });
});

describe('CA-21: política e salão suspenso', () => {
  it('política padrão (D-038): salão com suspenso_manual_em recusa equipe (403) e público (salao_indisponivel)', async () => {
    const c = await criarCenarioReserva();
    await db().salao.update({ where: { id: c.s.salaoId }, data: { suspensoManualEm: new Date() } });
    await expect(criarReserva(c.ctxEquipe, entradaReserva(c))).rejects.toMatchObject({ status: 403 });
    expect(await criarReserva(c.ctxSistema, entradaReserva(c, um(c, sp(DIA, '12:00'))))).toEqual({ resultado: 'salao_indisponivel' });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('política injetada negando: nada é gravado', async () => {
    const c = await criarCenarioReserva();
    const politica = () => ({ permitido: false as const, motivo: 'suspenso' });
    expect(await criarReserva(c.ctxSistema, entradaReserva(c), { politica })).toEqual({ resultado: 'salao_indisponivel' });
    await expect(criarReserva(c.ctxEquipe, entradaReserva(c), { politica })).rejects.toMatchObject({ status: 403 });
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });
});

describe('CA-27: a exclusion constraint é a garantia final', () => {
  it('INSERT direto de item sobreposto → 23P01 de reserva_item_sem_sobreposicao reconhecido sobre o erro REAL', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c));
    if (r.resultado !== 'criada') throw new Error('esperava criada');
    const outra = await ocupar(c, { inicio: sp(DIA, '15:00'), fim: sp(DIA, '15:30') });
    const i = r.reserva.itens[0];
    const erro = await db()
      .$executeRaw`INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate, status, preco_centavos, duracao_min)
        VALUES (${c.s.salaoId}::uuid, ${outra}::uuid, ${c.B}::uuid, ${c.ana}::uuid, 1, ${i.inicio}::timestamptz,
                ${new Date(i.inicio.getTime() + 45 * MIN_MS)}::timestamptz, ${new Date(i.inicio.getTime() + 45 * MIN_MS)}::timestamptz, 'confirmado', 7000, 45)`
      .then(() => null, (e: unknown) => e);
    expect(erro).not.toBeNull();
    expect(ehConflitoDeSobreposicao(erro)).toBe(true);
  });

  it('profissionais diferentes no mesmo horário: ambas aceitas', async () => {
    const c = await criarCenarioReserva();
    await jornadaDaBia(c);
    const a = await criarReserva(c.ctxEquipe, entradaReserva(c));
    const b = await criarReserva(c.ctxEquipe, entradaReserva(c, um(c, sp(DIA, '10:00'), { profissionalId: c.bia })));
    expect([a.resultado, b.resultado]).toEqual(['criada', 'criada']);
  });

  it('o mesmo pedido duas vezes sem chave: a segunda é horario_indisponivel', async () => {
    const c = await criarCenarioReserva();
    const a = await criarReserva(c.ctxEquipe, entradaReserva(c));
    const b = await criarReserva(c.ctxEquipe, entradaReserva(c));
    expect(a.resultado).toBe('criada');
    expect(b).toEqual(revalidacao());
    expect(MIN_MS).toBe(60_000);
    expect(AGORA.getTime()).toBeLessThan(sp(DIA, '10:00').getTime());
  });
});
