import { afterAll, describe, expect, it } from 'vitest';

import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma } from '@/server/repos/db';

import {
  criarAssinaturaEm,
  criarSalaoComAssinatura,
  criarSalaoSemAssinatura,
  iso,
  lerAssinatura,
  pagamentosDe,
  transicoesDe,
} from '../../support/assinatura';

// D-037: CA-1, 2, 8, 9, 11, 13 (cancelamento), 14, 16 e S-3, contra o PostgreSQL real.

afterAll(async () => {
  await encerrarPrisma();
});

const d = (s: string) => new Date(s);
const AGORA = d('2027-03-10T00:00:00Z');
let n = 0;
const pid = () => `pg-${Date.now()}-${n++}`;
const aprovada = (pagoEm: Date, pagamentoId = pid()) => ({ tipo: 'cobranca_aprovada' as const, pagamentoId, valorCentavos: 7900, pagoEm });

describe('aplicarEventoAssinatura', () => {
  it('CA-1: teste -> ativa, pago_ate = fim + 1 mês, 1 transição com causa e aplicado_em', async () => {
    const s = await criarSalaoComAssinatura('em_teste', { testeFimEm: d('2027-03-10T00:00:00Z') });
    const r = await aplicarEventoAssinatura(s.ctx, aprovada(AGORA), AGORA);
    expect(r).toMatchObject({ resultado: 'aplicado', de: 'em_teste', para: 'ativa', transicoes: 1 });
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('ativa');
    expect(iso(a.periodoPagoAte)).toBe('2027-04-10T00:00:00.000Z');
    expect(iso(a.atualizadoEm)).toBe(AGORA.toISOString());
    const t = await transicoesDe(s.assinaturaId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ de: 'em_teste', para: 'ativa', causa: 'pagamento_aprovado' });
    expect(iso(t[0].ocorridaEm)).toBe(AGORA.toISOString());
    const p = await pagamentosDe(s.assinaturaId);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ status: 'aprovado', valorCentavos: 7900 });
    expect(iso(p[0].aplicadoEm)).toBe(AGORA.toISOString());
  });

  it('CA-9: pagamento antes do fim do teste não encurta', async () => {
    const s = await criarSalaoComAssinatura('em_teste', { testeFimEm: d('2027-03-10T00:00:00Z') });
    await aplicarEventoAssinatura(s.ctx, aprovada(d('2027-03-01T00:00:00Z')), d('2027-03-01T00:00:00Z'));
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-04-10T00:00:00.000Z');
  });

  it('CA-2: falha em ativa -> carência; segunda falha não altera nem gera transição', async () => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-04-01T00:00:00Z') });
    const r = await aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_falhou', pagamentoId: pid(), falhouEm: AGORA }, AGORA);
    expect(r).toMatchObject({ resultado: 'aplicado', para: 'em_carencia' });
    const a1 = await lerAssinatura(s.assinaturaId);
    expect(iso(a1.carenciaAte)).toBe('2027-03-13T00:00:00.000Z');
    expect(iso(a1.primeiraFalhaEm)).toBe(AGORA.toISOString());
    const dia1 = d('2027-03-11T00:00:00Z');
    const r2 = await aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_falhou', pagamentoId: pid(), falhouEm: dia1 }, dia1);
    expect(r2).toEqual({ resultado: 'sem_efeito' });
    const a2 = await lerAssinatura(s.assinaturaId);
    expect(iso(a2.carenciaAte)).toBe(iso(a1.carenciaAte));
    expect(iso(a2.primeiraFalhaEm)).toBe(iso(a1.primeiraFalhaEm));
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
    const p = await pagamentosDe(s.assinaturaId);
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.status === 'recusado' && x.valorCentavos === 7900)).toBe(true);
    expect(p[1].aplicadoEm).toBeNull();
  });

  it('CA-4/CA-11: suspensa + aprovada -> ativa a partir do pagamento, limpa a falha', async () => {
    const s = await criarSalaoComAssinatura('suspensa', {
      periodoPagoAte: d('2027-05-05T00:00:00Z'),
      primeiraFalhaEm: d('2027-05-08T00:00:00Z'),
      carenciaAte: d('2027-05-11T00:00:00Z'),
    });
    const quando = d('2027-05-20T00:00:00Z');
    await aplicarEventoAssinatura(s.ctx, aprovada(quando), quando);
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('ativa');
    expect(iso(a.periodoPagoAte)).toBe('2027-06-20T00:00:00.000Z');
    expect(a.primeiraFalhaEm).toBeNull();
    expect(a.carenciaAte).toBeNull();
  });

  it('ativa + aprovada: avança pago_ate sem transição', async () => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-03-31T00:00:00Z') });
    const r = await aplicarEventoAssinatura(s.ctx, aprovada(AGORA), AGORA);
    expect(r).toMatchObject({ resultado: 'aplicado', de: 'ativa', para: 'ativa', transicoes: 0 });
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-04-30T00:00:00.000Z');
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
    expect((await pagamentosDe(s.assinaturaId))[0].aplicadoEm).not.toBeNull();
  });

  it('CA-14/S-3: aprovada em encerrada e cancelada é ignorada; o pagamento fica registrado sem aplicar', async () => {
    const s = await criarSalaoComAssinatura('encerrada');
    const antes = await lerAssinatura(s.assinaturaId);
    const r = await aplicarEventoAssinatura(s.ctx, aprovada(AGORA), AGORA);
    expect(r).toEqual({ resultado: 'ignorado', motivo: 'assinatura_encerrada' });
    const depois = await lerAssinatura(s.assinaturaId);
    expect(depois).toEqual(antes);
    const p = await pagamentosDe(s.assinaturaId);
    expect(p).toHaveLength(1);
    expect(p[0].aplicadoEm).toBeNull();
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);

    const c = await criarSalaoComAssinatura('cancelada', { acessoAte: d('2027-04-01T00:00:00Z') });
    expect(await aplicarEventoAssinatura(c.ctx, aprovada(AGORA), AGORA)).toEqual({ resultado: 'ignorado', motivo: 'assinatura_encerrada' });
    expect((await lerAssinatura(c.assinaturaId)).estado).toBe('cancelada');
  });

  it('CA-14: falha em suspensa é sem_efeito', async () => {
    const s = await criarSalaoComAssinatura('suspensa');
    expect(await aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_falhou', falhouEm: AGORA }, AGORA)).toEqual({ resultado: 'sem_efeito' });
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
  });

  it('aprovada em pendente: ignorada', async () => {
    const s = await criarSalaoComAssinatura('pendente');
    expect(await aplicarEventoAssinatura(s.ctx, aprovada(AGORA), AGORA)).toEqual({ resultado: 'ignorado', motivo: 'assinatura_pendente' });
  });

  it('teste_iniciado: pendente -> em_teste com 30 dias; repetir é sem_efeito', async () => {
    const s = await criarSalaoComAssinatura('pendente');
    await aplicarEventoAssinatura(s.ctx, { tipo: 'teste_iniciado' }, AGORA);
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('em_teste');
    expect(iso(a.testeFimEm)).toBe('2027-04-09T00:00:00.000Z');
    expect(await aplicarEventoAssinatura(s.ctx, { tipo: 'teste_iniciado' }, AGORA)).toEqual({ resultado: 'sem_efeito' });
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('CA-13/RN-5: cancelar ativa -> cancelada com acesso_ate = pago_ate; de novo é sem_efeito', async () => {
    const s = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-04-01T00:00:00Z') });
    const r = await aplicarEventoAssinatura(s.ctx, { tipo: 'cancelamento' }, AGORA);
    expect(r).toMatchObject({ resultado: 'aplicado', para: 'cancelada' });
    const a = await lerAssinatura(s.assinaturaId);
    expect(iso(a.acessoAte)).toBe('2027-04-01T00:00:00.000Z');
    expect(iso(a.canceladaEm)).toBe(AGORA.toISOString());
    expect(await aplicarEventoAssinatura(s.ctx, { tipo: 'cancelamento' }, AGORA)).toEqual({ resultado: 'sem_efeito' });
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it.each(['pendente', 'em_carencia', 'suspensa'] as const)('cancelar %s encerra na hora', async (estado) => {
    const s = await criarSalaoComAssinatura(estado);
    await aplicarEventoAssinatura(s.ctx, { tipo: 'cancelamento' }, AGORA);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('encerrada');
    expect((await transicoesDe(s.assinaturaId))[0]).toMatchObject({ de: estado, para: 'encerrada', causa: 'cancelamento_gestor' });
  });

  it('sem assinatura: sem_assinatura; evento_id gravado; id malformado ou de outro salão', async () => {
    const vazio = await criarSalaoSemAssinatura();
    expect(await aplicarEventoAssinatura(vazio.ctx, { tipo: 'cancelamento' }, AGORA)).toEqual({ resultado: 'sem_assinatura' });
    expect(await aplicarEventoAssinatura(vazio.ctx, { tipo: 'prazo' }, AGORA, { assinaturaId: 'x' })).toEqual({ resultado: 'sem_assinatura' });

    // CA-16: assinatura de outro salão nunca é alvo.
    const a = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-04-01T00:00:00Z') });
    const b = await criarSalaoComAssinatura('ativa', { periodoPagoAte: d('2027-04-01T00:00:00Z') });
    expect(await aplicarEventoAssinatura(a.ctx, { tipo: 'cancelamento' }, AGORA, { assinaturaId: b.assinaturaId })).toEqual({ resultado: 'sem_assinatura' });
    expect((await lerAssinatura(b.assinaturaId)).estado).toBe('ativa');
    await aplicarEventoAssinatura(a.ctx, { tipo: 'cancelamento' }, AGORA);
    expect((await lerAssinatura(a.assinaturaId)).estado).toBe('cancelada');
    expect((await lerAssinatura(b.assinaturaId)).estado).toBe('ativa');
    expect(await transicoesDe(b.assinaturaId)).toHaveLength(0);
  });

  it('só a vigente é alvo; sem vigente, pagamento cai na mais recente (S-3)', async () => {
    const s = await criarSalaoSemAssinatura();
    const velha = await criarAssinaturaEm(s.salaoId, 'encerrada', { criadoEm: d('2026-01-01T00:00:00Z') });
    const vigente = await criarAssinaturaEm(s.salaoId, 'ativa', { periodoPagoAte: d('2027-04-01T00:00:00Z') });
    await aplicarEventoAssinatura(s.ctx, aprovada(AGORA), AGORA);
    expect(await pagamentosDe(vigente)).toHaveLength(1);
    expect(await pagamentosDe(velha)).toHaveLength(0);
    // sem vigente
    const t = await criarSalaoSemAssinatura();
    const e = await criarAssinaturaEm(t.salaoId, 'encerrada');
    expect(await aplicarEventoAssinatura(t.ctx, aprovada(AGORA), AGORA)).toEqual({ resultado: 'ignorado', motivo: 'assinatura_encerrada' });
    expect(await pagamentosDe(e)).toHaveLength(1);
    // evento sem pagamento e sem vigente
    expect(await aplicarEventoAssinatura(t.ctx, { tipo: 'cancelamento' }, AGORA)).toEqual({ resultado: 'sem_assinatura' });
  });

  it('valor divergente é só registrado (log) e o efeito é aplicado', async () => {
    const s = await criarSalaoComAssinatura('suspensa');
    const logs: string[] = [];
    const r = await aplicarEventoAssinatura(
      s.ctx,
      { tipo: 'cobranca_aprovada', pagamentoId: pid(), valorCentavos: 100, pagoEm: AGORA },
      AGORA,
      { log: (e) => logs.push(e) },
    );
    expect(r.resultado).toBe('aplicado');
    expect(logs).toEqual(['assinatura.valor_divergente']);
  });
});
