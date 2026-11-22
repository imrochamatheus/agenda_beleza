import { afterAll, describe, expect, it } from 'vitest';

import { DIAS_TESTE } from '@/config/plano';
import { iniciarAssinatura } from '@/server/assinatura/iniciar';
import { consultarRetorno } from '@/server/assinatura/retorno';
import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { ErroProvedor } from '@/server/integrations/mercadopago/port';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { criarAssinaturaEm } from '../../support/assinatura';
import { APP_URL, criarSalaoD40, mp, simDoSalao, transicoes, vigenteDe } from './apoio-iniciar';

// D-040: CA-1, CA-2, CA-3, CA-6, CA-7, CA-8, CA-10, CA-11 (serviços contra PostgreSQL real e MP simulado).

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date('2027-05-10T12:00:00Z');
const DIA_MS = 86_400_000;

describe('iniciarAssinatura', () => {
  it('CA-1: cria a pendente vinculada ao simulado cuja referência é o salaoId', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const r = await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    expect(r.resultado).toBe('iniciada');
    const [a] = await vigenteDe(salaoId);
    const [sim] = await simDoSalao(salaoId);
    expect(a.estado).toBe('pendente');
    expect(a.testeFimEm).toBeNull();
    expect(a.provedorAssinaturaId).toBe(sim.id);
    expect(sim.urlRetorno).toBe('http://localhost:3000/painel/assinatura/retorno');
    expect(sim.valorCentavos).toBe(7900);
    if (r.resultado === 'iniciada') expect(r.urlCheckout).toBe(`${APP_URL}/dev/mp-checkout?assinatura=${sim.id}`);
    expect(await transicoes(a.id)).toHaveLength(0);
  });

  it('APP_URL com barra final ou caminho vira origem + rota de retorno', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: 'https://app.exemplo.com.br/base/' });
    expect((await simDoSalao(salaoId))[0].urlRetorno).toBe('https://app.exemplo.com.br/painel/assinatura/retorno');
  });

  it('CA-2: retorno com parâmetros forjados não muda nada enquanto o provedor não autorizou', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const antes = (await vigenteDe(salaoId))[0];
    // a página ignora a query string: o serviço nem a recebe
    expect(await consultarRetorno(ctx, AGORA, { mp })).toBe('aguardando');
    const depois = (await vigenteDe(salaoId))[0];
    expect(depois).toEqual(antes);
    expect(depois.estado).toBe('pendente');
    expect(await transicoes(depois.id)).toHaveLength(0);
    expect((await estadoEfetivoDoSalao(ctx, AGORA)).capacidades.agendar).toBe(false);
  });

  it('CA-3: autorização confirmada inicia o teste com fim = autorização + 30 dias; reprocessar é sem efeito', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const [sim] = await simDoSalao(salaoId);
    const em = new Date('2027-05-08T03:04:05.000Z');
    await mp.autorizar(sim.id, { em });
    expect(await consultarRetorno(ctx, AGORA, { mp })).toBe('teste_iniciado');
    const [a] = await vigenteDe(salaoId);
    expect(a.estado).toBe('em_teste');
    expect(a.testeFimEm?.toISOString()).toBe(new Date(em.getTime() + DIAS_TESTE * DIA_MS).toISOString());
    const t = await transicoes(a.id);
    expect(t).toHaveLength(1);
    expect(t[0].ocorridaEm.toISOString()).toBe(AGORA.toISOString());
    expect((await estadoEfetivoDoSalao(ctx, AGORA)).capacidades.agendar).toBe(true);
    expect(await consultarRetorno(ctx, AGORA, { mp })).toBe('ja_em_teste');
    expect(await transicoes(a.id)).toHaveLength(1);
    expect((await vigenteDe(salaoId))[0].testeFimEm).toEqual(a.testeFimEm);
  });

  it('CA-6: falha do provedor mantém a pendente sem vínculo; a nova tentativa reutiliza a linha', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await mp.forcarErro('criarAssinatura');
    expect(await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).toEqual({ resultado: 'provedor_indisponivel' });
    const [a] = await vigenteDe(salaoId);
    expect(a.provedorAssinaturaId).toBeNull();
    expect(await transicoes(a.id)).toHaveLength(0);
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    const vig = await vigenteDe(salaoId);
    expect(vig).toHaveLength(1);
    expect(vig[0].id).toBe(a.id);
    expect(vig[0].provedorAssinaturaId).not.toBeNull();
  });

  it('CA-7: falha ao consultar no retorno deixa o estado e responde indisponível', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const antes = (await vigenteDe(salaoId))[0];
    await mp.forcarErro('consultarAssinatura');
    expect(await consultarRetorno(ctx, AGORA, { mp })).toBe('indisponivel');
    expect((await vigenteDe(salaoId))[0]).toEqual(antes);
  });

  it('retorno sem assinatura ou sem vínculo: sem_assinatura e sem consulta', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const nunca: PortaMercadoPago = new Proxy({} as PortaMercadoPago, {
      get() {
        throw new Error('não deveria consultar');
      },
    });
    expect(await consultarRetorno(ctx, AGORA, { mp: nunca })).toBe('sem_assinatura');
    await criarAssinaturaEm(salaoId, 'pendente');
    expect(await consultarRetorno(ctx, AGORA, { mp: nunca })).toBe('sem_assinatura');
  });

  it('CA-8: pendente com provedor pendente: novo vínculo e a antiga cancelada no simulado', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const [antiga] = await simDoSalao(salaoId);
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    const sims = await simDoSalao(salaoId);
    expect(sims).toHaveLength(2);
    expect(sims[0].estado).toBe('cancelada');
    const vig = await vigenteDe(salaoId);
    expect(vig).toHaveLength(1);
    expect(vig[0].provedorAssinaturaId).toBe(sims[1].id);
    expect(vig[0].provedorAssinaturaId).not.toBe(antiga.id);
  });

  it('CA-8: provedor cancelado: nova assinatura; provedor autorizado: não cria outra e inicia o teste', async () => {
    const a = await criarSalaoD40();
    await iniciarAssinatura(a.ctx, AGORA, { mp, appUrl: APP_URL });
    const [s1] = await simDoSalao(a.salaoId);
    await mp.cancelar(s1.id);
    expect((await iniciarAssinatura(a.ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    expect(await simDoSalao(a.salaoId)).toHaveLength(2);

    const b = await criarSalaoD40();
    await iniciarAssinatura(b.ctx, AGORA, { mp, appUrl: APP_URL });
    const [sb] = await simDoSalao(b.salaoId);
    await mp.autorizar(sb.id, { em: AGORA });
    expect(await iniciarAssinatura(b.ctx, AGORA, { mp, appUrl: APP_URL })).toEqual({ resultado: 'teste_iniciado' });
    expect(await simDoSalao(b.salaoId)).toHaveLength(1);
    expect((await vigenteDe(b.salaoId))[0].estado).toBe('em_teste');
  });

  it('consulta da pendente com vínculo desconhecido no provedor segue e troca o vínculo; erro de consulta é indisponível', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    const id = await criarAssinaturaEm(salaoId, 'pendente');
    await obterPrisma().assinatura.update({ where: { id }, data: { provedorAssinaturaId: 'inexistente' } });
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    await mp.forcarErro('consultarAssinatura');
    expect(await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).toEqual({ resultado: 'provedor_indisponivel' });
  });

  it('CA-10: com vigente em_teste/ativa/… recusa sem chamar a porta', async () => {
    const nunca: PortaMercadoPago = new Proxy({} as PortaMercadoPago, {
      get() {
        throw new Error('não deveria chamar');
      },
    });
    for (const estado of ['em_teste', 'ativa', 'em_carencia', 'cancelada', 'suspensa'] as const) {
      const { salaoId, ctx } = await criarSalaoD40();
      // `cancelada` ainda dentro do acesso pago (D-042 RN-8: vencida seria encerrada e liberaria a nova).
      await criarAssinaturaEm(salaoId, estado, estado === 'cancelada' ? { acessoAte: new Date(AGORA.getTime() + DIA_MS) } : {});
      expect(await iniciarAssinatura(ctx, AGORA, { mp: nunca, appUrl: APP_URL })).toEqual({ resultado: 'recusado', motivo: 'ja_existe' });
      expect(await vigenteDe(salaoId)).toHaveLength(1);
    }
  });

  it('assinatura encerrada não impede uma nova pendente', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await criarAssinaturaEm(salaoId, 'encerrada');
    expect((await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    expect(await vigenteDe(salaoId)).toHaveLength(1);
  });

  it('CA-11: provedor com salaoId de outro salão: recusa sem evento', async () => {
    const a = await criarSalaoD40();
    const b = await criarSalaoD40();
    // assinatura do provedor do salão B, sem vínculo em nenhuma linha local
    const alheia = await mp.criarAssinatura({ salaoId: b.salaoId, emailPagador: 'b@exemplo.com', urlRetorno: `${APP_URL}/r` });
    const simB = { id: alheia.assinaturaId };
    await mp.autorizar(simB.id, { em: AGORA });
    const idA = await criarAssinaturaEm(a.salaoId, 'pendente');
    await obterPrisma().assinatura.update({ where: { id: idA }, data: { provedorAssinaturaId: simB.id } });
    expect(await consultarRetorno(a.ctx, AGORA, { mp })).toBe('vinculo_invalido');
    const [pa] = await vigenteDe(a.salaoId);
    expect(pa.estado).toBe('pendente');
    expect(await transicoes(idA)).toHaveLength(0);
    // iniciar nessa situação não cancela nem aproveita a assinatura alheia
    expect((await iniciarAssinatura(a.ctx, AGORA, { mp, appUrl: APP_URL })).resultado).toBe('iniciada');
    expect((await simDoSalao(b.salaoId))[0].estado).toBe('autorizada');
    expect(await vigenteDe(b.salaoId)).toHaveLength(0);
  });

  it('retorno com provedor cancelado, estado não pendente e vínculo trocado', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const [sim] = await simDoSalao(salaoId);
    await mp.cancelar(sim.id);
    expect(await consultarRetorno(ctx, AGORA, { mp })).toBe('cancelada_no_provedor');
    // estado já ativa e provedor autorizado: neutro (o evento é ignorado)
    const c = await criarSalaoD40();
    const id = await criarAssinaturaEm(c.salaoId, 'ativa');
    const criada = await mp.criarAssinatura({ salaoId: c.salaoId, emailPagador: 'x@exemplo.com', urlRetorno: `${APP_URL}/r` });
    await mp.autorizar(criada.assinaturaId, { em: AGORA });
    await obterPrisma().assinatura.update({ where: { id }, data: { provedorAssinaturaId: criada.assinaturaId } });
    expect(await consultarRetorno(c.ctx, AGORA, { mp })).toBe('neutro');
    // provedor pendente com estado não pendente: neutro
    const d = await criarSalaoD40();
    const id2 = await criarAssinaturaEm(d.salaoId, 'em_teste');
    const criada2 = await mp.criarAssinatura({ salaoId: d.salaoId, emailPagador: 'x@exemplo.com', urlRetorno: `${APP_URL}/r` });
    await obterPrisma().assinatura.update({ where: { id: id2 }, data: { provedorAssinaturaId: criada2.assinaturaId } });
    expect(await consultarRetorno(d.ctx, AGORA, { mp })).toBe('neutro');
  });

  it('valor divergente do provedor só gera log e o teste inicia', async () => {
    const { salaoId, ctx } = await criarSalaoD40();
    await iniciarAssinatura(ctx, AGORA, { mp, appUrl: APP_URL });
    const [sim] = await simDoSalao(salaoId);
    await mp.autorizar(sim.id, { em: AGORA });
    await obterPrisma().simMpAssinatura.update({ where: { id: sim.id }, data: { valorCentavos: 5000 } });
    const logs: [string, Record<string, unknown>][] = [];
    expect(await consultarRetorno(ctx, AGORA, { mp, log: (e, c) => logs.push([e, c]) })).toBe('teste_iniciado');
    expect(logs.map((l) => l[0])).toContain('assinatura.valor_divergente');
    expect(Object.keys(logs[0][1])).toEqual(['assinaturaId']);
  });

  it('erro não previsto da porta propaga em criarAssinatura; ErroProvedor vira indisponível', async () => {
    const { ctx } = await criarSalaoD40();
    const quebrada = { ...mp, criarAssinatura: async () => { throw new TypeError('bug'); } } as unknown as PortaMercadoPago;
    await expect(iniciarAssinatura(ctx, AGORA, { mp: quebrada, appUrl: APP_URL })).rejects.toThrow('bug');
    const falha = { ...mp, criarAssinatura: async () => { throw new ErroProvedor(); } } as unknown as PortaMercadoPago;
    expect((await iniciarAssinatura(ctx, AGORA, { mp: falha, appUrl: APP_URL })).resultado).toBe('provedor_indisponivel');
  });
});
