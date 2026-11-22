import { afterAll, describe, expect, it } from 'vitest';

import { processarPrazos } from '@/server/assinatura/prazos';
import { consultarRetorno } from '@/server/assinatura/retorno';
import { notificacaoSimulada } from '@/server/integrations/mercadopago/webhook-simulado';
import { encerrarPrisma } from '@/server/repos/db';
import { criarTenantContext } from '@/server/tenant/context';

import { iso, lerAssinatura, pagamentosDe, transicoesDe } from '../../support/assinatura';
import { AGORA, enviar, eventosDoSalao, mp, novaChave, salaoComMp } from './apoio-webhook';

// D-041 CA-11: webhook x retorno (D-040) x job de prazo e entregas distintas em paralelo, sem 5xx,
// sem 23505, sem impasse (40P01) e com uma única extensão de período.

afterAll(async () => {
  await encerrarPrisma();
});

const sem5xx = (rs: Response[]) => expect(rs.map((r) => r.status).filter((s) => s >= 500)).toEqual([]);
const D = (s: string) => new Date(s);

describe('concorrência do webhook', () => {
  it('10 entregas distintas em paralelo (10 salões): todas 200 e cada pagamento aplicado uma vez', async () => {
    const salas = await Promise.all(Array.from({ length: 10 }, () => salaoComMp('suspensa')));
    const pagamentos = await Promise.all(salas.map((s) => mp.aprovarCobranca(s.simId, { em: AGORA })));
    const rs = await Promise.all(salas.map((_, i) => enviar(notificacaoSimulada('pagamento', pagamentos[i].pagamentoId, AGORA, novaChave()))));
    sem5xx(rs);
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(200));
    for (const s of salas) {
      expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
      expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
      expect((await eventosDoSalao(s.salaoId)).map((e) => e.resultado)).toEqual(['processado']);
    }
  });

  it('10 notificações distintas do MESMO pagamento em paralelo: período estendido uma vez', async () => {
    const s = await salaoComMp('ativa', { periodoPagoAte: D('2027-05-20T00:00:00Z') });
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const rs = await Promise.all(Array.from({ length: 10 }, () => enviar(notificacaoSimulada('pagamento', pagamentoId, AGORA, novaChave()))));
    sem5xx(rs);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-06-20T00:00:00.000Z');
    const ev = await eventosDoSalao(s.salaoId);
    expect(ev).toHaveLength(10);
    expect(ev.filter((e) => e.erro === 'pagamento_duplicado')).toHaveLength(9);
  });

  it('mesma chave em 10 entregas paralelas: uma linha, um efeito', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = notificacaoSimulada('pagamento', pagamentoId, AGORA, novaChave());
    const rs = await Promise.all(Array.from({ length: 10 }, () => enviar(n)));
    sem5xx(rs);
    expect((await eventosDoSalao(s.salaoId)).map((e) => e.resultado)).toEqual(['processado']);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('webhook x retorno x job de prazo sobre a mesma assinatura', async () => {
    const s = await salaoComMp('pendente');
    await mp.autorizar(s.simId, { em: AGORA });
    const ctx = criarTenantContext({ usuarioId: crypto.randomUUID(), papel: 'gestor', salaoId: s.salaoId, profissionalId: null });
    const rs = await Promise.allSettled([
      enviar(notificacaoSimulada('assinatura', s.simId, AGORA, novaChave())),
      consultarRetorno(ctx, AGORA, { mp }),
      processarPrazos(AGORA),
      enviar(notificacaoSimulada('assinatura', s.simId, AGORA, novaChave())),
      consultarRetorno(ctx, AGORA, { mp }),
    ]);
    expect(rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    sem5xx([rs[0], rs[3]].map((r) => (r as PromiseFulfilledResult<Response>).value));
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('em_teste');
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('webhook de pagamento x job de prazo x retorno: uma extensão de período', async () => {
    const s = await salaoComMp('em_carencia', { carenciaAte: D('2027-05-09T00:00:00Z'), primeiraFalhaEm: D('2027-05-06T00:00:00Z') });
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const ctx = criarTenantContext({ usuarioId: crypto.randomUUID(), papel: 'gestor', salaoId: s.salaoId, profissionalId: null });
    const rs = await Promise.allSettled([
      enviar(notificacaoSimulada('pagamento', pagamentoId, AGORA, novaChave())),
      processarPrazos(AGORA),
      consultarRetorno(ctx, AGORA, { mp }),
      enviar(notificacaoSimulada('pagamento', pagamentoId, AGORA, novaChave())),
    ]);
    expect(rs.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    sem5xx([rs[0], rs[3]].map((r) => (r as PromiseFulfilledResult<Response>).value));
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
  });
});
