import { afterAll, describe, expect, it } from 'vitest';

import { iniciarAssinatura } from '@/server/assinatura/iniciar';
import { encerrarPrisma } from '@/server/repos/db';

import { lerAssinatura, transicoesDe } from '../../support/assinatura';
import { criarAssinaturaEm } from '../../support/assinatura';
import { APP_URL, criarSalaoD40, mp, simDoSalao, vigenteDe } from './apoio-iniciar';
import { nuncaChamada } from './apoio-cancelar';

// D-042 CA-10 / RN-8: nova assinatura depois de `encerrada` ou de `cancelada` com o acesso vencido (o job
// de prazo ainda não rodou); a antiga permanece no histórico e a encerrada ganha uma transição de prazo.

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date('2027-05-10T12:00:00Z');
const DIA_MS = 86_400_000;

describe('iniciarAssinatura depois de encerrada ou cancelada vencida', () => {
  it('CA-10: cancelada com acesso vencido vira encerrada (prazo_acesso) e nasce uma nova pendente', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const velha = await criarAssinaturaEm(salaoId, 'cancelada', { acessoAte: new Date(AGORA.getTime() - DIA_MS), criadoEm: new Date(AGORA.getTime() - 60 * DIA_MS) });
    const r = await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    expect(r.resultado).toBe('iniciada');
    expect((await lerAssinatura(velha)).estado).toBe('encerrada');
    expect((await transicoesDe(velha)).map((t) => [t.de, t.para, t.causa])).toEqual([['cancelada', 'encerrada', 'prazo_acesso']]);
    const vig = await vigenteDe(salaoId);
    expect(vig).toHaveLength(1);
    expect(vig[0].estado).toBe('pendente');
    expect(vig[0].id).not.toBe(velha);
    expect(await simDoSalao(salaoId)).toHaveLength(1);
  });

  it('CA-10: encerrada não impede a nova pendente e permanece no histórico', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const velha = await criarAssinaturaEm(salaoId, 'encerrada');
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    expect((await lerAssinatura(velha)).estado).toBe('encerrada');
    expect(await transicoesDe(velha)).toHaveLength(0);
    expect((await vigenteDe(salaoId))[0].id).not.toBe(velha);
  });

  it('cancelada ainda dentro do acesso continua recusando (ja_existe), sem transição nem chamada ao provedor', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const id = await criarAssinaturaEm(salaoId, 'cancelada', { acessoAte: new Date(AGORA.getTime() + DIA_MS) });
    expect(await iniciarAssinatura(ctx, AGORA, { mp: nuncaChamada, appUrl: APP_URL })).toEqual({ resultado: 'recusado', motivo: 'ja_existe' });
    expect((await lerAssinatura(id)).estado).toBe('cancelada');
    expect(await transicoesDe(id)).toHaveLength(0);
  });

  it('cancelada com acesso_ate no limite exato (= agora) conta como vencida', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await criarAssinaturaEm(salaoId, 'cancelada', { acessoAte: AGORA });
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
  });
});
