import { afterAll, describe, expect, it } from 'vitest';

import { processarPrazos } from '@/server/assinatura/prazos';
import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma } from '@/server/repos/db';

import { criarSalaoComAssinatura, lerAssinatura, pagamentosDe, transicoesDe } from '../../support/assinatura';

// D-037 CA-7: job x aprovada em paralelo (ambas as ordens), e cancelamento x aprovada; sem 40P01/5xx.

afterAll(async () => {
  await encerrarPrisma();
});

const d = (s: string) => new Date(s);
const AGORA = d('2027-03-10T00:00:00Z');

function semFalha(rs: PromiseSettledResult<unknown>[]) {
  expect(rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
}

describe('concorrência da assinatura', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i))('CA-7 (#%i): job x aprovada termina ativa', async (i) => {
    const s = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z'), primeiraFalhaEm: d('2027-03-06T00:00:00Z') });
    const aprovar = () =>
      aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: `c7-${i}-${s.salaoId}`, valorCentavos: 7900, pagoEm: AGORA }, AGORA);
    const job = () => aplicarEventoAssinatura(s.ctx, { tipo: 'prazo' }, AGORA, { assinaturaId: s.assinaturaId, pularTravada: true });
    const rs = await Promise.allSettled(i % 2 === 0 ? [aprovar(), job()] : [job(), aprovar()]);
    semFalha(rs);
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('ativa');
    expect((await pagamentosDe(s.assinaturaId))[0].aplicadoEm).not.toBeNull();
    // sem job: 1 transição; com o job primeiro: suspensa -> ativa
    // (ocorrida_em é igual nas duas: a ordem entre elas não é observável pelo relógio injetado)
    const t = (await transicoesDe(s.assinaturaId)).map((x) => x.para).sort();
    expect(t.includes('ativa')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(2);
    expect(t.filter((x) => x === 'ativa')).toHaveLength(1);
  });

  it('job real (processarPrazos) x aprovada em paralelo termina ativa', async () => {
    const s = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
    const rs = await Promise.allSettled([
      processarPrazos(AGORA),
      aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: 'real-' + s.salaoId, valorCentavos: 7900, pagoEm: AGORA }, AGORA),
    ]);
    semFalha(rs);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
  });

  it.each(Array.from({ length: 5 }, (_, i) => i))('cancelamento x aprovada (#%i): estado final consistente, sem impasse', async (i) => {
    const s = await criarSalaoComAssinatura('suspensa');
    const rs = await Promise.allSettled([
      aplicarEventoAssinatura(s.ctx, { tipo: 'cancelamento' }, AGORA),
      aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: `cx-${i}-${s.salaoId}`, valorCentavos: 7900, pagoEm: AGORA }, AGORA),
    ]);
    semFalha(rs);
    const a = await lerAssinatura(s.assinaturaId);
    const p = await pagamentosDe(s.assinaturaId);
    expect(p).toHaveLength(1);
    if (a.estado === 'encerrada') {
      expect(p[0].aplicadoEm).toBeNull();
    } else {
      // aprovada primeiro: ativa e depois cancelada (acesso até pago_ate)
      expect(a.estado).toBe('cancelada');
      expect(p[0].aplicadoEm).not.toBeNull();
    }
  });

  it('dez aprovadas distintas em paralelo na mesma assinatura: todas aplicadas, sem impasse', async () => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-03-20T00:00:00Z') });
    const rs = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: `dez-${i}-${s.salaoId}`, valorCentavos: 7900, pagoEm: AGORA }, AGORA),
      ),
    );
    semFalha(rs);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(10);
  });
});
