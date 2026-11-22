import { describe, expect, it } from 'vitest';

import { decidir } from './maquina-estados';
import { ESTADOS_ASSINATURA } from './tipos';
import type { AssinaturaBruta, EventoDominio } from './tipos';

const d = (s: string) => new Date(s);
const base = (estado: string, extra: Partial<AssinaturaBruta> = {}): AssinaturaBruta => ({
  estado,
  testeFimEm: null,
  periodoPagoAte: null,
  primeiraFalhaEm: null,
  carenciaAte: null,
  canceladaEm: null,
  acessoAte: null,
  ...extra,
});
const AGORA = d('2027-03-10T00:00:00.000Z');

describe('decidir: aprovada', () => {
  it('CA-1: teste -> ativa, pago_ate = fim + 1 mês', () => {
    const r = decidir(base('em_teste', { testeFimEm: d('2027-03-10T00:00:00Z') }), { tipo: 'cobranca_aprovada', pagoEm: AGORA }, AGORA);
    expect(r).toMatchObject({ tipo: 'transicoes', passos: [{ de: 'em_teste', para: 'ativa', origem: 'pagamento_aprovado' }] });
    if (r.tipo === 'transicoes') expect(r.passos[0].campos.periodoPagoAte?.toISOString()).toBe('2027-04-10T00:00:00.000Z');
  });
  it('CA-9: pagamento antes do fim do teste não encurta', () => {
    const r = decidir(base('em_teste', { testeFimEm: d('2027-03-10T00:00:00Z') }), { tipo: 'cobranca_aprovada', pagoEm: d('2027-03-01T00:00:00Z') }, AGORA);
    if (r.tipo !== 'transicoes') throw new Error('esperava transição');
    expect(r.passos[0].campos.periodoPagoAte?.toISOString()).toBe('2027-04-10T00:00:00.000Z');
  });
  it('ativa: avança a partir do maior entre pago_ate e pagamento (sem transição)', () => {
    const r = decidir(base('ativa', { periodoPagoAte: d('2027-05-05T00:00:00Z') }), { tipo: 'cobranca_aprovada', pagoEm: d('2027-05-01T00:00:00Z') }, AGORA);
    expect(r).toEqual({ tipo: 'atualiza', campos: { periodoPagoAte: d('2027-06-05T00:00:00Z') } });
    const s = decidir(base('ativa'), { tipo: 'cobranca_aprovada', pagoEm: d('2027-01-31T00:00:00Z') }, AGORA);
    expect(s).toEqual({ tipo: 'atualiza', campos: { periodoPagoAte: d('2027-02-28T00:00:00Z') } });
  });
  it.each(['em_carencia', 'suspensa'])('CA-11: %s -> ativa a partir do pagamento, limpa a falha', (estado) => {
    const r = decidir(
      base(estado, { periodoPagoAte: d('2027-05-05T00:00:00Z'), primeiraFalhaEm: AGORA, carenciaAte: AGORA }),
      { tipo: 'cobranca_aprovada', pagoEm: d('2027-05-20T00:00:00Z') },
      AGORA,
    );
    if (r.tipo !== 'transicoes') throw new Error('esperava transição');
    expect(r.passos[0].para).toBe('ativa');
    expect(r.passos[0].campos).toEqual({ periodoPagoAte: d('2027-06-20T00:00:00Z'), primeiraFalhaEm: null, carenciaAte: null });
  });
  it('pendente e encerradas são ignoradas', () => {
    const ev: EventoDominio = { tipo: 'cobranca_aprovada', pagoEm: AGORA };
    expect(decidir(base('pendente'), ev, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'assinatura_pendente' });
    expect(decidir(base('encerrada'), ev, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'assinatura_encerrada' });
    expect(decidir(base('cancelada'), ev, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'assinatura_encerrada' });
  });
});

describe('decidir: falha', () => {
  it('CA-2: ativa e teste -> carência de 3 dias', () => {
    for (const estado of ['ativa', 'em_teste']) {
      const r = decidir(base(estado), { tipo: 'cobranca_falhou', falhouEm: AGORA }, AGORA);
      if (r.tipo !== 'transicoes') throw new Error('esperava transição');
      expect(r.passos[0]).toMatchObject({ para: 'em_carencia', origem: 'pagamento_recusado' });
      expect(r.passos[0].campos).toEqual({ primeiraFalhaEm: AGORA, carenciaAte: d('2027-03-13T00:00:00Z') });
    }
  });
  it('CA-14: sem efeito em carência, suspensa e encerrada; ignorada em pendente e cancelada', () => {
    const ev: EventoDominio = { tipo: 'cobranca_falhou', falhouEm: AGORA };
    for (const e of ['em_carencia', 'suspensa', 'encerrada']) expect(decidir(base(e), ev, AGORA)).toEqual({ tipo: 'sem_efeito' });
    for (const e of ['pendente', 'cancelada']) expect(decidir(base(e), ev, AGORA).tipo).toBe('ignorado');
  });
});

describe('decidir: cancelamento', () => {
  const ev: EventoDominio = { tipo: 'cancelamento' };
  it('teste e ativa terminam o acesso no fim do período', () => {
    const t = decidir(base('em_teste', { testeFimEm: d('2027-04-01T00:00:00Z') }), ev, AGORA);
    if (t.tipo !== 'transicoes') throw new Error('x');
    expect(t.passos[0].campos).toEqual({ canceladaEm: AGORA, acessoAte: d('2027-04-01T00:00:00Z') });
    const a = decidir(base('ativa', { periodoPagoAte: d('2027-05-01T00:00:00Z') }), ev, AGORA);
    if (a.tipo !== 'transicoes') throw new Error('x');
    expect(a.passos[0]).toMatchObject({ para: 'cancelada' });
    expect(a.passos[0].campos.acessoAte).toEqual(d('2027-05-01T00:00:00Z'));
    const sem = decidir(base('ativa'), ev, AGORA);
    if (sem.tipo !== 'transicoes') throw new Error('x');
    expect(sem.passos[0].campos.acessoAte).toEqual(AGORA);
  });
  it('pendente, carência e suspensa encerram na hora; cancelada/encerrada sem efeito', () => {
    for (const e of ['pendente', 'em_carencia', 'suspensa']) {
      const r = decidir(base(e), ev, AGORA);
      expect(r).toMatchObject({ tipo: 'transicoes', passos: [{ para: 'encerrada', origem: 'cancelamento_gestor' }] });
    }
    for (const e of ['cancelada', 'encerrada']) expect(decidir(base(e), ev, AGORA)).toEqual({ tipo: 'sem_efeito' });
  });
});

describe('decidir: prazo', () => {
  const ev: EventoDominio = { tipo: 'prazo' };
  it('CA-3: carência vence de forma inclusiva', () => {
    const a = base('em_carencia', { carenciaAte: AGORA });
    expect(decidir(a, ev, AGORA)).toMatchObject({ passos: [{ de: 'em_carencia', para: 'suspensa', origem: 'prazo_carencia' }] });
    expect(decidir(a, ev, new Date(AGORA.getTime() - 1))).toEqual({ tipo: 'sem_efeito' });
  });
  it('CA-15/RN-12: teste vencido vai à carência; com carência também vencida, duas transições', () => {
    const a = base('em_teste', { testeFimEm: d('2027-03-01T00:00:00Z') });
    const um = decidir(a, ev, d('2027-03-02T00:00:00Z'));
    if (um.tipo !== 'transicoes') throw new Error('x');
    expect(um.passos).toHaveLength(1);
    expect(um.passos[0].campos).toEqual({ primeiraFalhaEm: d('2027-03-01T00:00:00Z'), carenciaAte: d('2027-03-04T00:00:00Z') });
    const dois = decidir(a, ev, d('2027-03-04T00:00:00Z'));
    if (dois.tipo !== 'transicoes') throw new Error('x');
    expect(dois.passos.map((p) => p.para)).toEqual(['em_carencia', 'suspensa']);
    expect(decidir(a, ev, d('2027-02-28T00:00:00Z'))).toEqual({ tipo: 'sem_efeito' });
  });
  it('CA-13: cancelada vencida (ou sem acesso_ate) encerra', () => {
    expect(decidir(base('cancelada', { acessoAte: AGORA }), ev, AGORA)).toMatchObject({ passos: [{ para: 'encerrada', origem: 'prazo_acesso' }] });
    expect(decidir(base('cancelada'), ev, AGORA).tipo).toBe('transicoes');
    expect(decidir(base('cancelada', { acessoAte: d('2027-03-11T00:00:00Z') }), ev, AGORA)).toEqual({ tipo: 'sem_efeito' });
  });
  it('demais estados sem efeito', () => {
    for (const e of ['pendente', 'ativa', 'suspensa', 'encerrada']) expect(decidir(base(e), ev, AGORA)).toEqual({ tipo: 'sem_efeito' });
  });
});

describe('decidir: teste_iniciado', () => {
  it('pendente -> em_teste com 30 dias; em_teste sem efeito; outros ignorados', () => {
    const r = decidir(base('pendente'), { tipo: 'teste_iniciado' }, AGORA);
    if (r.tipo !== 'transicoes') throw new Error('x');
    expect(r.passos[0].campos.testeFimEm).toEqual(d('2027-04-09T00:00:00Z'));
    expect(decidir(base('em_teste'), { tipo: 'teste_iniciado' }, AGORA)).toEqual({ tipo: 'sem_efeito' });
    expect(decidir(base('ativa'), { tipo: 'teste_iniciado' }, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'estado_incompativel' });
  });
});

describe('decidir: teste_iniciado com iniciadoEm (D-040)', () => {
  it('conta os 30 dias da autorização e ignora data inválida', () => {
    const r = decidir(base('pendente'), { tipo: 'teste_iniciado', iniciadoEm: d('2027-03-01T12:00:00Z') }, AGORA);
    if (r.tipo !== 'transicoes') throw new Error('x');
    expect(r.passos[0].campos.testeFimEm).toEqual(d('2027-03-31T12:00:00Z'));
    const inv = decidir(base('pendente'), { tipo: 'teste_iniciado', iniciadoEm: new Date('x') }, AGORA);
    if (inv.tipo !== 'transicoes') throw new Error('x');
    expect(inv.passos[0].campos.testeFimEm).toEqual(d('2027-04-09T00:00:00Z'));
  });
});

describe('CA-18: exaustivo e total', () => {
  const eventos: EventoDominio[] = [
    { tipo: 'teste_iniciado' },
    { tipo: 'cobranca_aprovada', pagoEm: AGORA },
    { tipo: 'cobranca_falhou', falhouEm: AGORA },
    { tipo: 'cancelamento' },
    { tipo: 'prazo' },
  ];
  it('7 estados x 5 eventos nunca lançam e devolvem decisão válida', () => {
    for (const e of ESTADOS_ASSINATURA) for (const ev of eventos) {
      expect(['transicoes', 'atualiza', 'sem_efeito', 'ignorado']).toContain(decidir(base(e), ev, AGORA).tipo);
    }
  });
  it('desconhecidos viram ignorado', () => {
    expect(decidir(base('xyz'), { tipo: 'prazo' }, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'desconhecido' });
    expect(decidir(base('ativa'), { tipo: 'zzz' } as never, AGORA)).toEqual({ tipo: 'ignorado', motivo: 'desconhecido' });
    expect(decidir(base('ativa'), null as never, AGORA).tipo).toBe('ignorado');
    expect(decidir(null as never, { tipo: 'prazo' }, AGORA).tipo).toBe('ignorado');
    expect(decidir(base('ativa'), { tipo: 'prazo' }, new Date(NaN)).tipo).toBe('ignorado');
    expect(decidir(base('ativa'), { tipo: 'cobranca_aprovada', pagoEm: 'x' as never }, AGORA).tipo).toBe('ignorado');
    expect(decidir(base('ativa'), { tipo: 'cobranca_falhou', falhouEm: 'x' as never }, AGORA).tipo).toBe('ignorado');
  });
});
