import { afterAll, describe, expect, it } from 'vitest';

import { cancelarAssinatura } from '@/server/assinatura/cancelar';
import { iniciarAssinatura } from '@/server/assinatura/iniciar';
import { consultarRetorno } from '@/server/assinatura/retorno';
import { notificacaoSimulada } from '@/server/integrations/mercadopago/webhook-simulado';
import { encerrarPrisma } from '@/server/repos/db';

import { lerAssinatura, transicoesDe } from '../../support/assinatura';
import { enviar, novaChave } from './apoio-webhook';
import { APP_URL, AGORA, D, mp, salaoGestor } from './apoio-cancelar';
import { vigenteDe } from './apoio-iniciar';

// D-042 CA-6 (cancelar duas vezes em paralelo) e CA-7 (cancelar × webhook × retorno, ×10, sem impasse,
// sem 5xx e sem transição duplicada).

afterAll(async () => {
  await encerrarPrisma();
});

const PAGO_ATE = D('2027-05-25T03:00:00Z');
const rejeitadas = (rs: PromiseSettledResult<unknown>[]) =>
  rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));

describe('concorrência do cancelamento', () => {
  it.each([2, 10])('CA-6: %i cancelamentos em paralelo: uma transição, acesso_ate inalterado, nenhuma resposta de erro', async (n) => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    const rs = await Promise.allSettled(Array.from({ length: n }, () => cancelarAssinatura(s.ctx, { estadoVisto: 'ativa' }, AGORA, { mp })));
    expect(rejeitadas(rs)).toEqual([]);
    const res = rs.map((r) => (r as PromiseFulfilledResult<{ resultado: string }>).value.resultado);
    expect(res.filter((x) => x === 'cancelada')).toHaveLength(1);
    expect(res.every((x) => x === 'cancelada' || x === 'ja_cancelada' || x === 'mudou')).toBe(true);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
    expect((await lerAssinatura(s.assinaturaId)).acessoAte?.toISOString()).toBe(PAGO_ATE.toISOString());
  });

  it('CA-7: cancelar × webhook de cancelamento × retorno × cancelar, 10 vezes: estado final coerente, uma transição de saída', async () => {
    for (let i = 0; i < 10; i += 1) {
      const s = await salaoGestor('pendente');
      await mp.autorizar(s.simId!, { em: AGORA });
      const rs = await Promise.allSettled([
        cancelarAssinatura(s.ctx, {}, AGORA, { mp }),
        (async () => {
          await mp.cancelar(s.simId!, { em: AGORA }).catch(() => undefined);
          return enviar(notificacaoSimulada('assinatura', s.simId!, AGORA, novaChave()));
        })(),
        consultarRetorno(s.ctx, AGORA, { mp }),
        cancelarAssinatura(s.ctx, {}, AGORA, { mp }),
        enviar(notificacaoSimulada('assinatura', s.simId!, AGORA, novaChave())),
      ]);
      expect(rejeitadas(rs)).toEqual([]);
      for (const r of [rs[1], rs[4]]) expect((r as PromiseFulfilledResult<Response>).value.status).toBeLessThan(500);
      const a = await lerAssinatura(s.assinaturaId);
      expect(['cancelada', 'encerrada']).toContain(a.estado);
      const t = await transicoesDe(s.assinaturaId);
      // pendente → em_teste → cancelada, ou pendente → encerrada; nunca duas saídas.
      expect(t.filter((x) => x.para === 'cancelada' || x.para === 'encerrada')).toHaveLength(1);
      expect(t.length).toBeLessThanOrEqual(2);
      expect(t.map((x) => x.para)).toContain(a.estado);
      expect((await mp.consultarAssinatura(s.simId!)).estado).toBe('cancelada');
    }
  }, 60_000);

  it('cancelar × iniciar em paralelo na pendente: sem erro de banco e no máximo uma vigente', async () => {
    for (let i = 0; i < 5; i += 1) {
      const s = await salaoGestor('pendente');
      const rs = await Promise.allSettled([
        cancelarAssinatura(s.ctx, {}, AGORA, { mp }),
        iniciarAssinatura(s.ctx, AGORA, { mp, appUrl: APP_URL }),
        cancelarAssinatura(s.ctx, {}, AGORA, { mp }),
        iniciarAssinatura(s.ctx, AGORA, { mp, appUrl: APP_URL }),
      ]);
      expect(rejeitadas(rs)).toEqual([]);
      expect((await vigenteDe(s.salaoId)).length).toBeLessThanOrEqual(1);
    }
  }, 60_000);
});
