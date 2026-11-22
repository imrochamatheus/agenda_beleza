import { describe, expect, it } from 'vitest';

import { decidirEstadoEfetivo } from '@/domain/assinatura';
import type { EstadoBruto } from '@/domain/assinatura';

import { avisoDoPlano } from './aviso';

// CA-5/CA-11: textos exatos da RN-11 e data no fuso do salão (rodar também com TZ=UTC e TZ=America/Sao_Paulo).
const AGORA = new Date('2026-11-20T12:00:00Z');
// 02:30 UTC de 1/12 = 23:30 de 30/11 em São Paulo (virada de dia).
const VIRADA = new Date('2026-12-01T02:30:00Z');
const SP = 'America/Sao_Paulo';

const com = (estado: string, extra: { carenciaAte?: Date; acessoAte?: Date } = {}): EstadoBruto => ({
  suspensoManualEm: null,
  assinatura: { estado, carenciaAte: extra.carenciaAte ?? null, acessoAte: extra.acessoAte ?? null },
});
const aviso = (b: EstadoBruto, papel: 'gestor' | 'profissional' = 'gestor', fuso = SP) =>
  avisoDoPlano(decidirEstadoEfetivo(b, AGORA), papel, fuso);

describe('avisoDoPlano', () => {
  it.each([
    ['sem assinatura', { suspensoManualEm: null, assinatura: null }],
    ['em_teste', com('em_teste')],
    ['ativa', com('ativa')],
  ])('%s: sem faixa', (_n, b) => {
    expect(aviso(b)).toBeNull();
    expect(aviso(b, 'profissional')).toBeNull();
  });

  it('textos do gestor (RN-11)', () => {
    expect(aviso(com('pendente'))).toEqual({
      tipo: 'aviso',
      texto: 'Assinatura pendente. Você já pode configurar o salão, mas o agendamento fica indisponível até a assinatura ser ativada.',
      link: { rotulo: 'Assinar agora', href: '/painel/assinatura' },
    });
    expect(aviso(com('em_carencia', { carenciaAte: VIRADA }))).toEqual({
      tipo: 'aviso',
      texto: 'Pagamento não confirmado. Seu acesso continua normal até 30/11/2026; regularize para evitar a suspensão.',
    });
    expect(aviso(com('cancelada', { acessoAte: VIRADA }))).toEqual({
      tipo: 'info',
      texto: 'Assinatura cancelada. Você pode usar o painel até 30/11/2026.',
    });
    expect(aviso(com('suspensa'))?.texto).toBe(
      'Assinatura suspensa. O painel está somente leitura e o agendamento está indisponível. Você ainda pode cancelar reservas futuras.',
    );
    expect(aviso(com('encerrada'))?.texto).toBe('Assinatura encerrada. Painel somente leitura; o agendamento está indisponível.');
    expect(aviso(com('cancelada', { acessoAte: AGORA }))?.texto).toBe(
      'Assinatura encerrada. Painel somente leitura; o agendamento está indisponível.',
    );
    expect(aviso({ ...com('ativa'), suspensoManualEm: AGORA })?.texto).toBe(
      'Salão suspenso pela administração. Painel somente leitura; você ainda pode cancelar reservas futuras. Entre em contato com o suporte.',
    );
  });

  it('a data sai no fuso do salão, não no do processo (virada de dia)', () => {
    const b = com('em_carencia', { carenciaAte: VIRADA });
    expect(aviso(b, 'gestor', 'America/Sao_Paulo')?.texto).toContain('até 30/11/2026;');
    expect(aviso(b, 'gestor', 'UTC')?.texto).toContain('até 01/12/2026;');
  });

  it('profissional: sem frase de ação do gestor; suspensões mandam falar com o gestor', () => {
    for (const b of [com('suspensa'), com('encerrada'), { ...com('ativa'), suspensoManualEm: AGORA }]) {
      const t = aviso(b, 'profissional')?.texto ?? '';
      expect(t).toMatch(/Fale com o gestor do salão\.$/);
      expect(t).not.toContain('suporte');
    }
    expect(aviso(com('pendente'), 'profissional')?.texto).toContain('assinatura pendente de regularização');
    expect(aviso(com('pendente'), 'profissional')?.link).toBeUndefined();
    expect(aviso(com('em_carencia', { carenciaAte: VIRADA }), 'profissional')?.texto).not.toMatch(/regularize/);
    expect(aviso(com('cancelada', { acessoAte: VIRADA }), 'profissional')?.texto).toContain('até 30/11/2026');
  });

  it('carência sem data não inventa prazo', () => {
    expect(aviso(com('em_carencia'))?.texto).toBe(
      'Pagamento não confirmado. Seu acesso continua normal; regularize para evitar a suspensão.',
    );
  });
});
