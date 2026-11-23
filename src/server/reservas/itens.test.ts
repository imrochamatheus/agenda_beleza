import { describe, expect, it } from 'vitest';

import type { StatusReserva } from '@/server/repos/tipos';

import { conferirItens, derivarReserva, derivarStatus, envelope } from './itens';
import type { ItemParaConferir } from './itens';

// D-050 §3.2 (A-1/A-2, RN-8/RN-9/RN-21): derivação pura dos campos da reserva e checagem entre itens.

const t = (hhmm: string, dia = '2026-12-01'): Date => new Date(`${dia}T${hhmm}:00Z`);
const item = (status: StatusReserva, ini: string, fim: string) => ({ status, inicio: t(ini), fim: t(fim) });
const AGORA = new Date('2026-11-20T12:00:00Z');

describe('derivarStatus (RN-21)', () => {
  it('confirmado vence todos', () => {
    expect(derivarStatus([{ status: 'cancelado' }, { status: 'concluido' }, { status: 'confirmado' }, { status: 'nao_compareceu' }])).toBe(
      'confirmado',
    );
  });

  it('concluido vence nao_compareceu e cancelado', () => {
    expect(derivarStatus([{ status: 'nao_compareceu' }, { status: 'cancelado' }, { status: 'concluido' }])).toBe('concluido');
  });

  it('nao_compareceu vence cancelado', () => {
    expect(derivarStatus([{ status: 'cancelado' }, { status: 'nao_compareceu' }])).toBe('nao_compareceu');
  });

  it('todos cancelados → cancelado; um só item → o dele', () => {
    expect(derivarStatus([{ status: 'cancelado' }, { status: 'cancelado' }])).toBe('cancelado');
    for (const s of ['confirmado', 'concluido', 'nao_compareceu', 'cancelado'] as const) {
      expect(derivarStatus([{ status: s }])).toBe(s);
    }
  });

  it('lista vazia ou status desconhecido → RangeError', () => {
    expect(() => derivarStatus([])).toThrow(RangeError);
    expect(() => derivarStatus([{ status: 'outro' as StatusReserva }])).toThrow(RangeError);
  });
});

describe('envelope (A-2)', () => {
  it('min(inicio) e max(fim) dos itens não cancelados, em qualquer ordem', () => {
    const e = envelope([item('confirmado', '14:00', '15:00'), item('cancelado', '08:00', '18:00'), item('concluido', '09:00', '09:30')]);
    expect(e).toEqual({ inicio: t('09:00'), fim: t('15:00') });
  });

  it('o item mais longo pode não ser o último a começar', () => {
    const e = envelope([item('confirmado', '09:00', '12:00'), item('confirmado', '10:00', '10:30')]);
    expect(e).toEqual({ inicio: t('09:00'), fim: t('12:00') });
  });

  it('todos cancelados → envelope de todos', () => {
    const e = envelope([item('cancelado', '10:00', '11:00'), item('cancelado', '08:00', '09:00')]);
    expect(e).toEqual({ inicio: t('08:00'), fim: t('11:00') });
  });

  it('remarcação de data do único item ativo leva o envelope para a nova data (A-2)', () => {
    const e = envelope([
      { status: 'cancelado' as const, inicio: t('09:00'), fim: t('10:00') },
      { status: 'confirmado' as const, inicio: t('09:00', '2026-12-05'), fim: t('10:00', '2026-12-05') },
    ]);
    expect(e).toEqual({ inicio: t('09:00', '2026-12-05'), fim: t('10:00', '2026-12-05') });
  });

  it('devolve Date novos (não aliasa os do item) e lista vazia → RangeError', () => {
    const i = item('confirmado', '09:00', '10:00');
    const e = envelope([i]);
    expect(e.inicio).not.toBe(i.inicio);
    expect(() => envelope([])).toThrow(RangeError);
  });
});

describe('derivarReserva', () => {
  it('reserva nova (anterior null) com itens ativos: canceladaEm null', () => {
    expect(derivarReserva([item('confirmado', '10:00', '10:30'), item('confirmado', '09:00', '09:45')], null, AGORA)).toEqual({
      status: 'confirmado',
      inicio: t('09:00'),
      fim: t('10:30'),
      canceladaEm: null,
    });
  });

  it('passa a cancelado agora → canceladaEm = agora', () => {
    const d = derivarReserva([item('cancelado', '09:00', '10:00')], { status: 'confirmado', canceladaEm: null }, AGORA);
    expect(d.status).toBe('cancelado');
    expect(d.canceladaEm).toEqual(AGORA);
  });

  it('já era cancelado → mantém o instante anterior', () => {
    const antes = new Date('2026-11-10T00:00:00Z');
    const d = derivarReserva([item('cancelado', '09:00', '10:00')], { status: 'cancelado', canceladaEm: antes }, AGORA);
    expect(d.canceladaEm).toEqual(antes);
  });

  it('cancelado sem instante anterior (dado legado) → agora', () => {
    const d = derivarReserva([item('cancelado', '09:00', '10:00')], { status: 'cancelado', canceladaEm: null }, AGORA);
    expect(d.canceladaEm).toEqual(AGORA);
  });

  it('cancelar um de dois itens não cancela a reserva', () => {
    const d = derivarReserva(
      [item('cancelado', '09:00', '10:00'), item('confirmado', '10:00', '11:00')],
      { status: 'confirmado', canceladaEm: null },
      AGORA,
    );
    expect(d).toEqual({ status: 'confirmado', inicio: t('10:00'), fim: t('11:00'), canceladaEm: null });
  });

  it('concluido + cancelado → concluido, sem canceladaEm', () => {
    const d = derivarReserva(
      [item('concluido', '09:00', '10:00'), item('cancelado', '10:00', '11:00')],
      { status: 'confirmado', canceladaEm: null },
      AGORA,
    );
    expect(d).toEqual({ status: 'concluido', inicio: t('09:00'), fim: t('10:00'), canceladaEm: null });
  });

  it('nova criação já toda cancelada (anterior null) → agora', () => {
    expect(derivarReserva([item('cancelado', '09:00', '10:00')], null, AGORA).canceladaEm).toEqual(AGORA);
  });
});

const FUSO = 'America/Sao_Paulo';
const ANA = '11111111-1111-4111-8111-111111111111';
const BIA = '22222222-2222-4222-8222-222222222222';

/** Item em hora de São Paulo (UTC−3) de 01/12/2026; duração e intervalo em minutos. */
function it2(prof: string, hhmm: string, dur: number, intervalo = 0, status: StatusReserva = 'confirmado', dia = 1): ItemParaConferir {
  const [h, m] = hhmm.split(':').map(Number);
  const inicio = new Date(Date.UTC(2026, 11, dia, h + 3, m));
  const fim = new Date(inicio.getTime() + dur * 60_000);
  return { profissionalId: prof, status, inicio, fim, ocupadoAte: new Date(fim.getTime() + intervalo * 60_000) };
}

describe('conferirItens (RN-8, RN-9, data única)', () => {
  it('itens encadeados ou separados, com profissionais distintos ou iguais → ok', () => {
    expect(conferirItens([it2(ANA, '09:00', 30), it2(BIA, '09:30', 45), it2(ANA, '10:15', 30)], FUSO)).toEqual({ ok: true });
  });

  it('lista vazia ou só cancelados → ok', () => {
    expect(conferirItens([], FUSO)).toEqual({ ok: true });
    expect(conferirItens([it2(ANA, '09:00', 30, 0, 'cancelado'), it2(ANA, '09:00', 30, 0, 'cancelado')], FUSO)).toEqual({ ok: true });
  });

  it('RN-8: profissionais diferentes com [inicio, fim) cruzados → entre_itens, falha o de maior índice', () => {
    expect(conferirItens([it2(ANA, '09:00', 60), it2(BIA, '09:30', 30)], FUSO)).toEqual({
      ok: false,
      motivo: 'entre_itens',
      itens: [1],
      conflitos: { 1: 0 },
    });
  });

  it('RN-8 é semiaberto: fim de um = início do outro não conflita', () => {
    expect(conferirItens([it2(ANA, '09:00', 30), it2(BIA, '09:30', 30)], FUSO)).toEqual({ ok: true });
  });

  it('RN-9: mesmo profissional, intervalo do salão (ocupadoAte) conta', () => {
    const r = conferirItens([it2(ANA, '09:00', 30, 15), it2(ANA, '09:40', 30, 15)], FUSO);
    expect(r).toEqual({ ok: false, motivo: 'entre_itens', itens: [1], conflitos: { 1: 0 } });
  });

  it('RN-9 não vale entre profissionais diferentes (o intervalo é do profissional)', () => {
    expect(conferirItens([it2(ANA, '09:00', 30, 15), it2(BIA, '09:35', 30, 15)], FUSO)).toEqual({ ok: true });
  });

  it('RN-9 compara ids sem diferenciar maiúsculas', () => {
    const r = conferirItens([it2(ANA, '09:00', 30, 15), it2(ANA.toUpperCase(), '09:40', 30)], FUSO);
    expect(r.ok).toBe(false);
  });

  it('item cancelado não conflita com ninguém', () => {
    expect(conferirItens([it2(ANA, '09:00', 60, 0, 'cancelado'), it2(BIA, '09:00', 60)], FUSO)).toEqual({ ok: true });
  });

  it('vários conflitos: cada k aponta o menor j que ele cruza; itens em ordem crescente', () => {
    const r = conferirItens([it2(ANA, '09:00', 60), it2(BIA, '11:00', 30), it2(BIA, '09:30', 30), it2(ANA, '11:15', 30)], FUSO);
    expect(r).toEqual({ ok: false, motivo: 'entre_itens', itens: [2, 3], conflitos: { 2: 0, 3: 1 } });
  });

  it('data local diferente do 1º item ativo → data_diferente com os índices', () => {
    const r = conferirItens([it2(ANA, '09:00', 30), it2(BIA, '09:00', 30, 0, 'confirmado', 2)], FUSO);
    expect(r).toEqual({ ok: false, motivo: 'data_diferente', itens: [1] });
  });

  it('a data é a LOCAL do salão: 21:30 em São Paulo já é o dia seguinte em UTC, mas a mesma data local', () => {
    expect(conferirItens([it2(ANA, '20:30', 30), it2(BIA, '21:30', 30)], FUSO)).toEqual({ ok: true });
    expect(conferirItens([it2(ANA, '20:30', 30), it2(BIA, '21:30', 30)], 'UTC')).toEqual({
      ok: false,
      motivo: 'data_diferente',
      itens: [1],
    });
  });

  it('a data de referência é a do 1º item NÃO cancelado', () => {
    const r = conferirItens([it2(ANA, '09:00', 30, 0, 'cancelado', 2), it2(BIA, '09:00', 30), it2(ANA, '10:00', 30)], FUSO);
    expect(r).toEqual({ ok: true });
  });
});
