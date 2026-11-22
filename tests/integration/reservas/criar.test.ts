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
  contarLinhas,
  criarCenarioReserva,
  entradaReserva,
  inserirReservaDireta,
  sp,
} from '../../support/reservas';
import { telefoneNovo } from '../../support/sql';

// D-025 T-6a: CA-1, CA-11, CA-12, CA-13, CA-21, CA-27 contra o PostgreSQL real.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();

describe('CA-1: itens em sequência com snapshot', () => {
  it('A (R$ 50, 30 min) + B (R$ 70, 45 min) às 10:00, intervalo 0', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { servicoIds: [c.A, c.B] }));
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    const reserva = await db().reserva.findUniqueOrThrow({ where: { id: r.reserva.id }, include: { itens: { orderBy: { ordem: 'asc' } } } });
    expect(reserva).toMatchObject({ status: 'confirmado', revisao: 0, canceladaEm: null, encaixe: false, origem: 'equipe', profissionalId: c.ana });
    expect(reserva.inicio).toEqual(sp(DIA, '10:00'));
    expect(reserva.fim).toEqual(sp(DIA, '11:15'));
    expect(reserva.ocupadoAte).toEqual(sp(DIA, '11:15'));
    expect(reserva.itens.map((i) => [i.servicoId, i.ordem, i.precoCentavos, i.duracaoMin])).toEqual([
      [c.A, 0, 5000, 30],
      [c.B, 1, 7000, 45],
    ]);
    expect(r.reserva.itens.map((i) => [i.inicio, i.fim])).toEqual([
      [sp(DIA, '10:00'), sp(DIA, '10:30')],
      [sp(DIA, '10:30'), sp(DIA, '11:15')],
    ]);
    expect(r.confirmacao.estado).toBe('pendente');
  });

  it('intervalo de 10 min: ocupado_ate = 11:25 e fim continua 11:15', async () => {
    const c = await criarCenarioReserva({ intervaloMin: 10 });
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { servicoIds: [c.A, c.B] }));
    expect(r.resultado).toBe('criada');
    const linha = await db().reserva.findFirstOrThrow({ where: { salaoId: c.s.salaoId } });
    expect(linha.fim).toEqual(sp(DIA, '11:15'));
    expect(linha.ocupadoAte).toEqual(sp(DIA, '11:25'));
  });

  it('alterar o serviço depois não altera o snapshot do item', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c));
    expect(r.resultado).toBe('criada');
    await db().servico.update({ where: { id: c.A }, data: { precoCentavos: 9900, duracaoMin: 60 } });
    const item = await db().reservaItem.findFirstOrThrow({ where: { salaoId: c.s.salaoId } });
    expect([item.precoCentavos, item.duracaoMin]).toEqual([5000, 30]);
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
    await inserirReservaDireta(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') });
    const enfileirar = vi.fn(async () => ({ criado: true as const, id: 'job' }));
    const r = await criarReserva(c.ctxSistema, entradaReserva(c), { enfileirar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: 'revalidacao' });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('cliente com consentimento anterior e nova reserva: nova mensagem (revisão 0 de outra reserva)', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const a = await criarReserva(c.ctxSistema, entradaReserva(c, { cliente: { nome: 'Ana', telefone } }));
    const b = await criarReserva(c.ctxSistema, entradaReserva(c, { cliente: { nome: 'Ana', telefone }, inicio: sp(DIA, '12:00') }));
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
    const pu = await criarReserva(c.ctxSistema, entradaReserva(c, { inicio: sp(DIA, '12:00') }));
    expect(eq.resultado === 'criada' && eq.reserva.origem).toBe('equipe');
    expect(pu.resultado === 'criada' && pu.reserva.origem).toBe('publico');
    const antes = await contarLinhas(c.s.salaoId);
    const publico = criarPublicoContext(c.s.salaoId, c.s.slugAtual) as unknown as ContextoEscopado;
    await expect(criarReserva(publico, entradaReserva(c, { inicio: sp(DIA, '14:00') }))).rejects.toThrow();
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
    expect(await criarReserva(c.ctxSistema, entradaReserva(c, { inicio: sp(DIA, '12:00') }))).toEqual({ resultado: 'salao_indisponivel' });
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
  it('INSERT direto sobreposto → 23P01 reconhecido sobre o erro REAL', async () => {
    const c = await criarCenarioReserva();
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c));
    if (r.resultado !== 'criada') throw new Error('esperava criada');
    const erro = await db()
      .$executeRaw`INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
        VALUES (${c.s.salaoId}::uuid, ${c.ana}::uuid, ${r.reserva.clienteId}::uuid, ${r.reserva.inicio}::timestamptz,
                ${r.reserva.fim}::timestamptz, ${r.reserva.ocupadoAte}::timestamptz, 'confirmado', 'equipe'::origem_reserva)`
      .then(() => null, (e: unknown) => e);
    expect(erro).not.toBeNull();
    expect(ehConflitoDeSobreposicao(erro)).toBe(true);
  });

  it('profissionais diferentes no mesmo horário: ambas aceitas', async () => {
    const c = await criarCenarioReserva();
    await db().jornada.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ salaoId: c.s.salaoId, profissionalId: c.bia, diaSemana, inicioMin: 540, fimMin: 1140 })),
    });
    const a = await criarReserva(c.ctxEquipe, entradaReserva(c));
    const b = await criarReserva(c.ctxEquipe, entradaReserva(c, { profissionalId: c.bia }));
    expect([a.resultado, b.resultado]).toEqual(['criada', 'criada']);
  });

  it('o mesmo pedido duas vezes sem chave: a segunda é horario_indisponivel', async () => {
    const c = await criarCenarioReserva();
    const a = await criarReserva(c.ctxEquipe, entradaReserva(c));
    const b = await criarReserva(c.ctxEquipe, entradaReserva(c));
    expect(a.resultado).toBe('criada');
    expect(b).toEqual({ resultado: 'horario_indisponivel', causa: 'revalidacao' });
    expect(MIN_MS).toBe(60_000);
    expect(AGORA.getTime()).toBeLessThan(sp(DIA, '10:00').getTime());
  });
});
