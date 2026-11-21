import { afterAll, describe, expect, it } from 'vitest';

import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { criarAdminContext, criarPublicoContext } from '@/server/tenant/context';

import { criarSalaoComAssinatura, criarSalaoSemAssinatura } from '../../support/assinatura';

// D-037: CA-4, CA-5, CA-6, CA-16 (estado efetivo).

afterAll(async () => {
  await encerrarPrisma();
});

const d = (s: string) => new Date(s);
const AGORA = d('2027-03-10T00:00:00Z');

describe('estadoEfetivoDoSalao', () => {
  it('CA-4: suspensa não agenda; depois de aprovada, agenda', async () => {
    const s = await criarSalaoComAssinatura('suspensa');
    expect((await estadoEfetivoDoSalao(s.ctx, AGORA)).capacidades.agendar).toBe(false);
    await aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: 'ee-' + s.salaoId, valorCentavos: 7900, pagoEm: AGORA }, AGORA);
    const e = await estadoEfetivoDoSalao(s.ctx, AGORA);
    expect(e).toMatchObject({ estado: 'ativa', motivo: 'assinatura' });
    expect(e.capacidades.agendar).toBe(true);
  });

  it('CA-5: cancelada vale até acesso_ate e vira encerrada antes do job', async () => {
    const s = await criarSalaoComAssinatura('em_teste', { testeFimEm: d('2027-03-31T00:00:00Z') });
    await aplicarEventoAssinatura(s.ctx, { tipo: 'cancelamento' }, d('2027-03-10T00:00:00Z'));
    const dia29 = await estadoEfetivoDoSalao(s.ctx, d('2027-03-29T00:00:00Z'));
    expect(dia29).toMatchObject({ estado: 'cancelada', acessoAte: d('2027-03-31T00:00:00Z') });
    expect(dia29.capacidades.agendar).toBe(true);
    const dia31 = await estadoEfetivoDoSalao(s.ctx, d('2027-03-31T00:00:00Z'));
    expect(dia31).toMatchObject({ estado: 'encerrada', motivo: 'cancelada_vencida' });
    expect(dia31.capacidades.agendar).toBe(false);
  });

  it('CA-6: suspensão manual prevalece sobre ativa', async () => {
    const s = await criarSalaoComAssinatura('ativa');
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: AGORA } });
    const e = await estadoEfetivoDoSalao(s.ctx, AGORA);
    expect(e).toMatchObject({ estado: 'manual', motivo: 'manual' });
    expect(e.capacidades).toMatchObject({ agendar: false, cancelar: true, leitura: true, configurar: false });
  });

  it('carência expõe carenciaAte; sem assinatura é permissivo; usa a mais recente', async () => {
    const c = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-12T00:00:00Z') });
    expect((await estadoEfetivoDoSalao(c.ctx, AGORA)).carenciaAte).toEqual(d('2027-03-12T00:00:00Z'));
    const v = await criarSalaoSemAssinatura();
    expect(await estadoEfetivoDoSalao(v.ctx, AGORA)).toMatchObject({ estado: 'sem_assinatura', motivo: 'sem_assinatura' });
  });

  it('CA-16: lê só o salão do contexto; aceita público; recusa admin e salão inexistente', async () => {
    const a = await criarSalaoComAssinatura('suspensa');
    const b = await criarSalaoComAssinatura('ativa');
    expect((await estadoEfetivoDoSalao(a.ctx, AGORA)).estado).toBe('suspensa');
    expect((await estadoEfetivoDoSalao(b.ctx, AGORA)).estado).toBe('ativa');
    expect((await estadoEfetivoDoSalao(criarPublicoContext(b.salaoId, 'x'), AGORA)).estado).toBe('ativa');
    await expect(estadoEfetivoDoSalao(criarAdminContext('6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4') as never, AGORA)).rejects.toThrow();
    await expect(estadoEfetivoDoSalao(criarPublicoContext('6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4', 'x'), AGORA)).rejects.toThrow();
  });
});
