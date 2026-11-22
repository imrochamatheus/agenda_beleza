import { afterAll, describe, expect, it } from 'vitest';

import { cancelarAssinatura, regularizarAssinatura } from '@/server/assinatura/assinatura.acao';
import { encerrarPrisma } from '@/server/repos/db';

import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import { lerAssinatura, transicoesDe } from '../../support/assinatura';
import { assinaturaVinculada, mp } from './apoio-cancelar';

// D-042 CA-4 (profissional 403, anônimo 401, sem efeito), CA-8 (isolamento A × B) e a entrada da ação.

afterAll(async () => {
  await encerrarPrisma();
});

// A sessão é de agora: a ação usa o relógio real (sessão fora do prazo seria 401).
const AGORA = new Date();
const FIM_TESTE = new Date(AGORA.getTime() + 10 * 86_400_000);
const PAGO_ATE = new Date(AGORA.getTime() + 20 * 86_400_000);

describe('ações cancelarAssinatura e regularizarAssinatura', () => {
  it('CA-8: o gestor de A cancela só a assinatura de A; B (ativa) e o provedor de B ficam intocados', async () => {
    const { a, b } = await criarDoisSaloes();
    const va = await assinaturaVinculada(a.salaoId, 'em_teste', { testeFimEm: FIM_TESTE });
    const vb = await assinaturaVinculada(b.salaoId, 'ativa', { periodoPagoAte: PAGO_ATE });
    const r = await cancelarAssinatura.executar(await credencialDoGestor(a), undefined, { agora: AGORA });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'cancelada', para: 'cancelada' } });
    expect((await lerAssinatura(va.assinaturaId)).estado).toBe('cancelada');
    expect((await mp.consultarAssinatura(va.simId)).estado).toBe('cancelada');
    expect((await lerAssinatura(vb.assinaturaId)).estado).toBe('ativa');
    expect((await mp.consultarAssinatura(vb.simId)).estado).toBe('autorizada');
    expect(await transicoesDe(vb.assinaturaId)).toHaveLength(0);
  });

  it('CA-8: a entrada não escolhe o alvo (id forjado e estadoVisto fora da lista são ignorados)', async () => {
    const { a, b } = await criarDoisSaloes();
    await assinaturaVinculada(a.salaoId, 'ativa', { periodoPagoAte: PAGO_ATE });
    const vb = await assinaturaVinculada(b.salaoId, 'ativa', { periodoPagoAte: PAGO_ATE });
    const forjada = { estadoVisto: 'qualquer', assinaturaId: vb.assinaturaId, salaoId: b.salaoId } as never;
    const r = await cancelarAssinatura.executar(await credencialDoGestor(a), forjada, { agora: AGORA });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'cancelada' } });
    expect((await lerAssinatura(vb.assinaturaId)).estado).toBe('ativa');
    expect((await mp.consultarAssinatura(vb.simId)).estado).toBe('autorizada');
  });

  it('CA-4: profissional recebe 403 e anônimo 401, sem efeito nem chamada ao provedor', async () => {
    const { a } = await criarDoisSaloes();
    const v = await assinaturaVinculada(a.salaoId, 'ativa', { periodoPagoAte: PAGO_ATE });
    for (const acao of [cancelarAssinatura, regularizarAssinatura] as const) {
      const p = await acao.executar(await credencialDoProfissional(a), undefined, { agora: AGORA });
      expect(p).toMatchObject({ ok: false, status: 403 });
      const n = await acao.executar({ token: 'x'.repeat(43) }, undefined, { agora: AGORA });
      expect(n).toMatchObject({ ok: false, status: 401 });
    }
    expect((await lerAssinatura(v.assinaturaId)).estado).toBe('ativa');
    expect((await mp.consultarAssinatura(v.simId)).estado).toBe('autorizada');
    expect(await transicoesDe(v.assinaturaId)).toHaveLength(0);
  });

  it('CA-9: a capacidade `assinatura` vale em suspensa: cancelar leva a encerrada; regularizar devolve a URL do provedor', async () => {
    const { a, b } = await criarDoisSaloes();
    await assinaturaVinculada(a.salaoId, 'suspensa');
    const vb = await assinaturaVinculada(b.salaoId, 'suspensa');
    const reg = await regularizarAssinatura.executar(await credencialDoGestor(a), undefined, { agora: AGORA });
    expect(reg).toMatchObject({ ok: true, dados: { resultado: 'iniciada' } });
    const can = await cancelarAssinatura.executar(await credencialDoGestor(b), undefined, { agora: AGORA });
    expect(can).toMatchObject({ ok: true, dados: { resultado: 'cancelada', para: 'encerrada' } });
    expect((await lerAssinatura(vb.assinaturaId)).estado).toBe('encerrada');
  });
});
