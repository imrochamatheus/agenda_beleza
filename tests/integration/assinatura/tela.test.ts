import { afterAll, describe, expect, it } from 'vitest';

import { lerTelaAssinatura } from '@/server/assinatura/tela';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { AGORA, D, salaoGestor } from './apoio-cancelar';
import { criarSalaoD40 } from './apoio-iniciar';

// D-042 CA-1, CA-8 (leitura isolada), CA-11, CA-12 (histórico) e a matriz de ações da tela.

afterAll(async () => {
  await encerrarPrisma();
});

describe('lerTelaAssinatura', () => {
  it('sem assinatura: estado sem_assinatura, ação assinar, sem datas nem pagamentos', async () => {
    const s = await criarSalaoD40();
    expect(await lerTelaAssinatura(s.ctx, AGORA)).toEqual({
      estado: 'sem_assinatura',
      estadoReal: null,
      fuso: 'America/Sao_Paulo',
      datas: {},
      acoes: { primaria: 'assinar', podeCancelar: false },
      pagamentos: [],
    });
  });

  it.each([
    ['pendente', {}, {}, 'continuar', true],
    ['em_teste', { testeFimEm: D('2027-05-20T03:00:00Z') }, { testeFimEm: D('2027-05-20T03:00:00Z') }, null, true],
    ['ativa', { periodoPagoAte: D('2027-05-25T03:00:00Z') }, { periodoPagoAte: D('2027-05-25T03:00:00Z') }, 'atualizar', true],
    ['em_carencia', { carenciaAte: D('2027-05-12T03:00:00Z') }, { carenciaAte: D('2027-05-12T03:00:00Z') }, 'regularizar', true],
    ['suspensa', { carenciaAte: D('2027-05-01T03:00:00Z') }, {}, 'regularizar', true],
    ['cancelada', { acessoAte: D('2027-05-30T03:00:00Z') }, { acessoAte: D('2027-05-30T03:00:00Z') }, null, false],
    ['encerrada', {}, {}, 'assinar_novamente', false],
  ] as const)('%s: datas só do estado e ações da matriz', async (estado, campos, datas, primaria, podeCancelar) => {
    const s = await salaoGestor(estado, campos);
    const t = await lerTelaAssinatura(s.ctx, AGORA);
    expect(t.estado).toBe(estado);
    expect(t.estadoReal).toBe(estado);
    expect(t.datas).toEqual(datas);
    expect(t.acoes).toEqual({ primaria, podeCancelar });
  });

  it('cancelada com o acesso vencido é encerrada para a tela, com "assinar novamente"; o estado real continua cancelada', async () => {
    const s = await salaoGestor('cancelada', { acessoAte: D('2027-05-01T00:00:00Z') });
    const t = await lerTelaAssinatura(s.ctx, AGORA);
    expect(t).toMatchObject({ estado: 'encerrada', estadoReal: 'cancelada', datas: {}, acoes: { primaria: 'assinar_novamente', podeCancelar: false } });
  });

  it('CA-11: salão suspenso pela administração é `manual`, sem ações, mesmo com assinatura ativa; mostra o histórico', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: D('2027-05-25T03:00:00Z') });
    await obterPrisma().assinaturaPagamento.create({ data: { assinaturaId: s.assinaturaId, pagamentoId: `pg-${s.assinaturaId}`, status: 'aprovado', valorCentavos: 7900 } });
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: AGORA } });
    const t = await lerTelaAssinatura(s.ctx, AGORA);
    expect(t).toMatchObject({ estado: 'manual', datas: {}, acoes: { primaria: null, podeCancelar: false } });
    expect(t.pagamentos).toHaveLength(1);
  });

  it('CA-12: até 12 pagamentos, mais recentes primeiro, só data, valor e situação', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: D('2027-05-25T03:00:00Z') });
    for (let i = 1; i <= 15; i += 1) {
      await obterPrisma().assinaturaPagamento.create({
        data: { assinaturaId: s.assinaturaId, pagamentoId: `pg-${s.assinaturaId}-${i}`, status: i === 15 ? 'recusado' : 'aprovado', valorCentavos: 7900, criadoEm: new Date(D('2027-01-01T00:00:00Z').getTime() + i * 86_400_000) },
      });
    }
    const t = await lerTelaAssinatura(s.ctx, AGORA);
    expect(t.pagamentos).toHaveLength(12);
    expect(t.pagamentos[0]).toEqual({ data: D('2027-01-16T00:00:00Z'), valorCentavos: 7900, situacao: 'recusado' });
    expect(t.pagamentos[11].data).toEqual(D('2027-01-05T00:00:00Z'));
    expect(Object.keys(t.pagamentos[0]).sort()).toEqual(['data', 'situacao', 'valorCentavos']);
    expect(JSON.stringify(t)).not.toContain(s.simId!);
  });

  it('CA-8: cada salão lê só o próprio estado, e o vínculo com o provedor nunca aparece', async () => {
    const a = await salaoGestor('em_teste', { testeFimEm: D('2027-05-20T03:00:00Z') });
    const b = await salaoGestor('ativa', { periodoPagoAte: D('2027-05-25T03:00:00Z') });
    expect((await lerTelaAssinatura(a.ctx, AGORA)).estado).toBe('em_teste');
    expect((await lerTelaAssinatura(b.ctx, AGORA)).estado).toBe('ativa');
    expect(JSON.stringify(await lerTelaAssinatura(a.ctx, AGORA))).not.toContain(a.simId!);
  });
});
