import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import { criarDecisorDeEncaixe } from '@/server/reservas/decisor-encaixe';
import { MENSAGENS_RESERVA } from '@/server/reservas/tipos';
import { emTransacao } from '@/server/repos/transacao';

import {
  AGORA,
  DIA,
  conferirDerivados,
  contarLinhas,
  criarCenarioReserva,
  entradaReserva,
  instalarContadorDeComandos,
  sp,
} from '../../support/reservas';

import { item, jornadaDaBia, ocupar, um } from './apoio-itens';

// D-025 T-6a: CA-16 (encaixe da equipe; a constraint continua valendo). D-050 T-5: encaixe por item
// (RN-16/RN-17) e o decisor em lote (`decisor-encaixe.ts`, A-11: 3 instruções para N itens).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const enfileirar = async () => ({ criado: true as const, id: 'job' });
const encaixe = { modo: 'encaixe' as const };

describe('CA-16: encaixe', () => {
  it('fora da jornada, do funcionamento e sobre bloqueio: aceito com encaixe = true', async () => {
    const c = await criarCenarioReserva({ funcionamento: { 2: [['10:00', '12:00']] } });
    await obterPrisma().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '14:00'), fim: sp(DIA, '15:00') } });
    for (const hhmm of ['07:00', '14:00', '22:30']) {
      const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { ...um(c, sp(DIA, hhmm)), ...encaixe }), { enfileirar });
      expect(r.resultado, hhmm).toBe('criada');
      if (r.resultado === 'criada') expect(r.reserva.itens.map((i) => i.encaixe)).toEqual([true]);
    }
    const linhas = await obterPrisma().reservaItem.findMany({ where: { salaoId: c.s.salaoId } });
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.encaixe)).toBe(true);
  });

  it('sobreposto a outra reserva ativa do mesmo profissional: 23P01', async () => {
    const c = await criarCenarioReserva();
    await ocupar(c, { inicio: sp(DIA, '22:00'), fim: sp(DIA, '22:30') });
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReserva(c.ctxEquipe, entradaReserva(c, { ...um(c, sp(DIA, '22:00')), ...encaixe }), { enfileirar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01', itens: [] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('no passado → invalido/inicio; no público → RangeError', async () => {
    const c = await criarCenarioReserva();
    const passado = new Date(AGORA.getTime() - 60 * 60_000);
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { itens: [item(c, new Date(AGORA.getTime() + 60 * 60_000)), item(c, passado, { servicoId: c.B })], ...encaixe }),
      { enfileirar },
    );
    expect(r).toEqual({ resultado: 'invalido', erros: { porItem: { 1: { inicio: MENSAGENS_RESERVA.inicioPassado } } } });
    await expect(criarReserva(c.ctxSistema, entradaReserva(c, { ...encaixe }), { enfileirar })).rejects.toThrow(RangeError);
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(0);
  });

  it('profissional inativo ou sem vínculo continua recusado', async () => {
    const c = await criarCenarioReserva();
    expect(
      await criarReserva(c.ctxEquipe, entradaReserva(c, { ...um(c, sp(DIA, '10:00'), { profissionalId: c.s.profissionalInativoId }), ...encaixe }), { enfileirar }),
    ).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
    expect(
      await criarReserva(c.ctxEquipe, entradaReserva(c, { ...um(c, sp(DIA, '10:00'), { profissionalId: c.bia, servicoId: c.B }), ...encaixe }), { enfileirar }),
    ).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
  });
});

describe('D-050 RN-17: encaixe por item com o decisor em lote', () => {
  // Jornada da Ana 09:00–19:00; Bia sem jornada até jornadaDaBia; bloqueio do salão 16:00–17:00.
  async function cenario() {
    const c = await criarCenarioReserva({ funcionamento: { 2: [['08:00', '20:00']] } });
    await jornadaDaBia(c);
    await obterPrisma().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: null, inicio: sp(DIA, '16:00'), fim: sp(DIA, '17:00') } });
    return c;
  }

  it('sem confirmação: encaixe_requer_confirmacao lista SÓ os itens com motivo, cada um com os seus; nada gravado', async () => {
    const c = await cenario();
    const antes = await contarLinhas(c.s.salaoId);
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, {
        ...encaixe,
        itens: [item(c, sp(DIA, '10:00'), { profissionalId: c.bia }), item(c, sp(DIA, '07:30'), { servicoId: c.B })],
      }),
      { enfileirar, decidirEncaixe: criarDecisorDeEncaixe(false) },
    );
    expect(r).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: [{ indice: 1, motivos: ['fora_da_jornada', 'fora_do_funcionamento'] }] });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('com confirmação: encaixe = true só nos itens que tinham motivo (bloqueio do salão vale para todos)', async () => {
    const c = await cenario();
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { ...encaixe, itens: [item(c, sp(DIA, '10:00'), { profissionalId: c.bia }), item(c, sp(DIA, '16:30'), { servicoId: c.B })] }),
      { enfileirar, decidirEncaixe: criarDecisorDeEncaixe(true) },
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => [i.profissionalId, i.encaixe])).toEqual([
      [c.bia, false],
      [c.ana, true],
    ]);
    const linhas = await obterPrisma().reservaItem.findMany({ where: { reservaId: r.reserva.id }, orderBy: { inicio: 'asc' } });
    expect(linhas.map((l) => l.encaixe)).toEqual([false, true]);
    await conferirDerivados(r.reserva.id);
  });

  it('sem motivo em nenhum item: encaixe false em todos, com ou sem confirmação', async () => {
    const c = await cenario();
    const r = await criarReserva(
      c.ctxEquipe,
      entradaReserva(c, { ...encaixe, itens: [item(c, sp(DIA, '10:00'), { profissionalId: c.bia }), item(c, sp(DIA, '11:00'), { servicoId: c.B })] }),
      { enfileirar, decidirEncaixe: criarDecisorDeEncaixe(true) },
    );
    expect(r.resultado === 'criada' && r.reserva.itens.map((i) => i.encaixe)).toEqual([false, false]);
  });

  it('bloqueio próprio de um profissional não afeta o item de outro', async () => {
    const c = await cenario();
    await obterPrisma().bloqueio.create({ data: { salaoId: c.s.salaoId, profissionalId: c.ana, inicio: sp(DIA, '10:00'), fim: sp(DIA, '11:00') } });
    const decidir = criarDecisorDeEncaixe(false);
    const d = await emTransacao((r) =>
      decidir(c.ctxEquipe, r, {
        fuso: 'America/Sao_Paulo',
        itens: [
          { profissionalId: c.bia, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') },
          { profissionalId: c.ana.toUpperCase(), inicio: sp(DIA, '10:30'), fim: sp(DIA, '11:15') },
        ],
      }),
    );
    expect(d).toEqual({ motivos: [{ indice: 1, motivos: ['bloqueado'] }] });
  });

  it('A-11: o decisor lê com exatamente 3 instruções, para 1 ou 3 itens; lote vazio é erro de programação', async () => {
    const c = await cenario();
    const decidir = criarDecisorDeEncaixe(true);
    const lote = (n: number) =>
      [
        { profissionalId: c.ana, inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:30') },
        { profissionalId: c.bia, inicio: sp(DIA, '11:00'), fim: sp(DIA, '11:30') },
        { profissionalId: c.ana, inicio: sp(DIA, '07:00'), fim: sp(DIA, '07:30') },
      ].slice(0, n);
    const contador = instalarContadorDeComandos();
    try {
      await emTransacao((r) => decidir(c.ctxEquipe, r, { fuso: 'America/Sao_Paulo', itens: lote(1) }));
      const medir = async (n: number) => {
        let dentro = 0;
        await emTransacao(async (r) => {
          contador.reiniciar();
          await decidir(c.ctxEquipe, r, { fuso: 'America/Sao_Paulo', itens: lote(n) });
          dentro = contador.contar();
        });
        return dentro;
      };
      expect(await medir(1)).toBe(3);
      expect(await medir(3)).toBe(3);
      await expect(emTransacao((r) => decidir(c.ctxEquipe, r, { fuso: 'America/Sao_Paulo', itens: [] }))).rejects.toThrow(RangeError);
    } finally {
      await contador.encerrar();
    }
  });
});
