import { describe, expect, it } from 'vitest';

import { TABELA_CAPACIDADES } from './capacidades';
import { decidirEstadoEfetivo } from './estado-efetivo';

const AGORA = new Date('2027-03-10T00:00:00Z');
const a = (estado: string, extra: { carenciaAte?: Date; acessoAte?: Date } = {}) => ({
  suspensoManualEm: null,
  assinatura: { estado, carenciaAte: extra.carenciaAte ?? null, acessoAte: extra.acessoAte ?? null },
});

describe('decidirEstadoEfetivo', () => {
  it('CA-6: manual prevalece', () => {
    const r = decidirEstadoEfetivo({ ...a('ativa'), suspensoManualEm: AGORA }, AGORA);
    expect(r).toMatchObject({ estado: 'manual', motivo: 'manual' });
    expect(r.capacidades).toMatchObject({ agendar: false, cancelar: true, leitura: true, configurar: false });
  });
  it('sem assinatura permite tudo', () => {
    const r = decidirEstadoEfetivo({ suspensoManualEm: null, assinatura: null }, AGORA);
    expect(r.estado).toBe('sem_assinatura');
    expect(Object.values(r.capacidades).every(Boolean)).toBe(true);
  });
  it('CA-4: ativa agenda; suspensa e encerrada não; pendente configura mas não agenda', () => {
    expect(decidirEstadoEfetivo(a('ativa'), AGORA).capacidades.agendar).toBe(true);
    for (const e of ['suspensa', 'encerrada']) {
      const c = decidirEstadoEfetivo(a(e), AGORA).capacidades;
      expect(c).toMatchObject({ agendar: false, configurar: false, cancelar: true });
    }
    expect(decidirEstadoEfetivo(a('pendente'), AGORA).capacidades).toMatchObject({ agendar: false, configurar: true });
  });
  it('CA-5: cancelada vale até acesso_ate (exclusivo)', () => {
    const vigente = decidirEstadoEfetivo(a('cancelada', { acessoAte: new Date(AGORA.getTime() + 1) }), AGORA);
    expect(vigente).toMatchObject({ estado: 'cancelada', acessoAte: new Date(AGORA.getTime() + 1) });
    expect(vigente.capacidades.agendar).toBe(true);
    for (const acessoAte of [AGORA, undefined]) {
      const v = decidirEstadoEfetivo(a('cancelada', { acessoAte }), AGORA);
      expect(v).toMatchObject({ estado: 'encerrada', motivo: 'cancelada_vencida' });
      expect(v.capacidades.agendar).toBe(false);
    }
  });
  it('carência expõe carenciaAte; estado desconhecido é restritivo', () => {
    const c = new Date('2027-03-12T00:00:00Z');
    expect(decidirEstadoEfetivo(a('em_carencia', { carenciaAte: c }), AGORA).carenciaAte).toEqual(c);
    expect(decidirEstadoEfetivo(a('em_carencia'), AGORA).carenciaAte).toBeUndefined();
    expect(decidirEstadoEfetivo(a('xyz'), AGORA).capacidades).toEqual(TABELA_CAPACIDADES.encerrada);
  });
  it('devolve cópia da tabela', () => {
    const r = decidirEstadoEfetivo(a('ativa'), AGORA);
    r.capacidades.agendar = false;
    expect(TABELA_CAPACIDADES.ativa.agendar).toBe(true);
  });
});
