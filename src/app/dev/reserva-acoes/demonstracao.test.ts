import { describe, expect, it } from 'vitest';

import { ANA_DEMO, BIA_DEMO, SERVICOS_DEMO } from '@/app/dev/reserva-nova/demonstracao';

import { demonstrarRemarcar, detalheDemo, lerVista } from './demonstracao';

// D-030: a vitrine usa as funções puras do serviço; nada é gravado.
const agora = new Date('2026-11-20T12:00:00Z');
const dia = '2026-12-01'; // terça
const base = { reservaId: 'x', data: dia, hora: '10:00', profissionalId: ANA_DEMO.id, servicoIds: [SERVICOS_DEMO[0].id] };

describe('lerVista', () => {
  it('lista fechada com padrão futura', () => {
    expect(lerVista('iniciada')).toBe('iniciada');
    expect(lerVista('x')).toBe('futura');
    expect(lerVista(undefined)).toBe('futura');
  });
});

describe('detalheDemo', () => {
  it('futura: início depois de agora; iniciada: início antes e fim depois', () => {
    const f = detalheDemo('futura', agora);
    expect(f.inicio.getTime()).toBeGreaterThan(agora.getTime());
    expect(f.status).toBe('confirmado');
    const i = detalheDemo('iniciada', agora);
    expect(i.inicio.getTime()).toBeLessThan(agora.getTime());
    expect(i.fim.getTime()).toBeGreaterThan(agora.getTime());
    expect(detalheDemo('concluida', agora).status).toBe('concluido');
    expect(detalheDemo('cancelada', agora).status).toBe('cancelado');
  });
});

describe('demonstrarRemarcar', () => {
  it('horário normal: atualizada, sem encaixe', () => {
    expect(demonstrarRemarcar(base, agora)).toMatchObject({ resultado: 'atualizada', reserva: { encaixe: false, profissionalId: ANA_DEMO.id } });
  });
  it('fora da jornada: pede confirmação e, confirmando, grava como encaixe', () => {
    expect(demonstrarRemarcar({ ...base, hora: '19:00' }, agora)).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: ['fora_da_jornada'] });
    expect(demonstrarRemarcar({ ...base, hora: '19:00', confirmarEncaixe: 'on' }, agora)).toMatchObject({ resultado: 'atualizada', reserva: { encaixe: true } });
  });
  it('entradas inválidas', () => {
    expect(demonstrarRemarcar({ ...base, hora: '99:99' }, agora)).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(demonstrarRemarcar({ ...base, servicoIds: [] }, agora)).toMatchObject({ resultado: 'invalido', erros: { servicos: expect.any(String) } });
    expect(demonstrarRemarcar({ ...base, servicoIds: 'x' }, agora)).toMatchObject({ resultado: 'invalido' });
    expect(demonstrarRemarcar({ ...base, data: '2026-11-19' }, agora)).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(demonstrarRemarcar({ ...base, profissionalId: 'outro' }, agora)).toEqual({ resultado: 'profissional_indisponivel' });
    expect(demonstrarRemarcar({ ...base, profissionalId: BIA_DEMO.id }, agora).resultado).toBe('atualizada');
  });
});
