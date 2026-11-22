import { afterAll, describe, expect, it } from 'vitest';

import { cancelarAssinatura } from '@/server/assinatura/cancelar';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { iso, lerAssinatura, transicoesDe } from '../../support/assinatura';
import { AGORA, D, espiar, mp, nuncaChamada, salaoGestor } from './apoio-cancelar';

// D-042: CA-2, CA-3, CA-9, CA-11 e os casos limite da §7 (serviço contra PostgreSQL real e MP simulado).

afterAll(async () => {
  await encerrarPrisma();
});

const PAGO_ATE = D('2027-05-25T03:00:00Z');
const FIM_TESTE = D('2027-05-20T03:00:00Z');

describe('cancelarAssinatura', () => {
  it('CA-2: ativa → cancelada com acesso_ate = periodo_pago_ate, uma transição cancelamento_gestor e provedor cancelado', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    const r = await cancelarAssinatura(s.ctx, { estadoVisto: 'ativa' }, AGORA, { mp });
    expect(r).toEqual({ resultado: 'cancelada', para: 'cancelada', acessoAte: PAGO_ATE, fuso: 'America/Sao_Paulo' });
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('cancelada');
    expect(iso(a.acessoAte)).toBe(PAGO_ATE.toISOString());
    expect(iso(a.canceladaEm)).toBe(AGORA.toISOString());
    expect((await transicoesDe(s.assinaturaId)).map((t) => [t.de, t.para, t.causa])).toEqual([['ativa', 'cancelada', 'cancelamento_gestor']]);
    expect((await mp.consultarAssinatura(s.simId!)).estado).toBe('cancelada');
  });

  it('em_teste → cancelada com acesso até o fim do teste', async () => {
    const s = await salaoGestor('em_teste', { testeFimEm: FIM_TESTE });
    const r = await cancelarAssinatura(s.ctx, {}, AGORA, { mp });
    expect(r).toMatchObject({ resultado: 'cancelada', para: 'cancelada', acessoAte: FIM_TESTE });
    expect(iso((await lerAssinatura(s.assinaturaId)).acessoAte)).toBe(FIM_TESTE.toISOString());
  });

  it.each(['pendente', 'em_carencia', 'suspensa'] as const)('CA-9: %s → encerrada (provedor cancelado, sem acesso)', async (estado) => {
    const s = await salaoGestor(estado, { carenciaAte: D('2027-05-12T00:00:00Z') });
    const r = await cancelarAssinatura(s.ctx, { estadoVisto: estado }, AGORA, { mp });
    expect(r).toEqual({ resultado: 'cancelada', para: 'encerrada', acessoAte: null, fuso: 'America/Sao_Paulo' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('encerrada');
    expect((await transicoesDe(s.assinaturaId)).map((t) => t.causa)).toEqual(['cancelamento_gestor']);
    expect((await mp.consultarAssinatura(s.simId!)).estado).toBe('cancelada');
  });

  it('pendente sem vínculo cancela só localmente, sem chamar o provedor', async () => {
    const s = await salaoGestor('pendente', {}, { semVinculo: true });
    const r = await cancelarAssinatura(s.ctx, {}, AGORA, { mp: nuncaChamada });
    expect(r).toMatchObject({ resultado: 'cancelada', para: 'encerrada' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('encerrada');
  });

  it('CA-3: erro do provedor → provedor_indisponivel; estado, datas e transições intactos', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    const antes = await lerAssinatura(s.assinaturaId);
    await mp.forcarErro('cancelarAssinatura');
    const logs: string[] = [];
    const r = await cancelarAssinatura(s.ctx, {}, AGORA, { mp, log: (e) => logs.push(e) });
    expect(r).toEqual({ resultado: 'provedor_indisponivel' });
    expect(await lerAssinatura(s.assinaturaId)).toEqual(antes);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
    expect(logs).toEqual(['assinatura.cancelar_provedor_falhou']);
    // O erro forçado foi consumido: a repetição cancela.
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp })).toMatchObject({ resultado: 'cancelada' });
  });

  it('vínculo inexistente no provedor e NaoImplementado também são provedor_indisponivel', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    await obterPrisma().assinatura.update({ where: { id: s.assinaturaId }, data: { provedorAssinaturaId: '00000000-0000-4000-8000-000000000000' } });
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp })).toEqual({ resultado: 'provedor_indisponivel' });
    const real: PortaMercadoPago = { ...mp, cancelarAssinatura: () => Promise.reject(new NaoImplementado('E6.6')) } as PortaMercadoPago;
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp: real })).toEqual({ resultado: 'provedor_indisponivel' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
  });

  it('erro que não é da porta propaga (defeito de programação não vira "erro de pagamento")', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    const quebrada = { ...mp, cancelarAssinatura: () => Promise.reject(new TypeError('bug')) } as PortaMercadoPago;
    await expect(cancelarAssinatura(s.ctx, {}, AGORA, { mp: quebrada })).rejects.toThrow('bug');
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
  });

  it('CA-6 (sequencial): a segunda tentativa é ja_cancelada, sem nova transição nem mudança de acesso_ate', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    await cancelarAssinatura(s.ctx, {}, AGORA, { mp });
    const r = await cancelarAssinatura(s.ctx, { estadoVisto: 'ativa' }, D('2027-05-11T00:00:00Z'), { mp });
    expect(r).toEqual({ resultado: 'ja_cancelada', acessoAte: PAGO_ATE, fuso: 'America/Sao_Paulo' });
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
    expect(iso((await lerAssinatura(s.assinaturaId)).acessoAte)).toBe(PAGO_ATE.toISOString());
  });

  it('cancelada antes pelo webhook (provedor já cancelado): ja_cancelada sem chamar o provedor', async () => {
    const s = await salaoGestor('em_teste', { testeFimEm: FIM_TESTE });
    await cancelarAssinatura(s.ctx, {}, AGORA, { mp });
    const e = espiar();
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp: e })).toMatchObject({ resultado: 'ja_cancelada' });
    expect(e.chamadas).toEqual([]);
  });

  it('o provedor cancela antes do webhook: a transição local acontece uma vez (sem_efeito → ja_cancelada)', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    await mp.cancelar(s.simId!, { em: AGORA });
    const r = await cancelarAssinatura(s.ctx, {}, AGORA, { mp });
    expect(r).toMatchObject({ resultado: 'cancelada', para: 'cancelada' });
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('CA-11: cancelada e encerrada recusam; manual recusa por motivo próprio; sem assinatura recusa', async () => {
    const e = espiar();
    const enc = await salaoGestor('encerrada');
    expect(await cancelarAssinatura(enc.ctx, {}, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'estado' });
    const man = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    await obterPrisma().salao.update({ where: { id: man.salaoId }, data: { suspensoManualEm: AGORA } });
    expect(await cancelarAssinatura(man.ctx, {}, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'manual' });
    expect((await lerAssinatura(man.assinaturaId)).estado).toBe('ativa');
    const sem = (await salaoGestor('ativa', {}, { semVinculo: true }));
    await obterPrisma().assinatura.delete({ where: { id: sem.assinaturaId } });
    expect(await cancelarAssinatura(sem.ctx, {}, AGORA, { mp: e })).toEqual({ resultado: 'recusado', motivo: 'estado' });
    expect(e.chamadas).toEqual([]);
  });

  it('estadoVisto diferente do real → mudou, sem chamar o provedor nem gravar', async () => {
    const s = await salaoGestor('em_carencia', { carenciaAte: D('2027-05-12T00:00:00Z') });
    const e = espiar();
    expect(await cancelarAssinatura(s.ctx, { estadoVisto: 'ativa' }, AGORA, { mp: e })).toEqual({ resultado: 'mudou' });
    expect(e.chamadas).toEqual([]);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('em_carencia');
  });

  it('o vínculo trocado entre a leitura e a trava (iniciar) → mudou, sem transição', async () => {
    const s = await salaoGestor('pendente');
    const e = espiar(async () => {
      // simula `iniciarAssinatura` trocando o vínculo enquanto o provedor é chamado
      await obterPrisma().assinatura.update({ where: { id: s.assinaturaId }, data: { provedorAssinaturaId: 'novo-vinculo' } });
    });
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp: e })).toEqual({ resultado: 'mudou' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('pendente');
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
  });

  it('falha do banco depois do provedor → tente_novamente com log só com o id; repetir converge', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    // Trigger de teste: derruba a gravação da transição, depois é removido.
    const prisma = obterPrisma();
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION d42_falha() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste D-042'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER d42_falha BEFORE INSERT ON assinatura_transicao FOR EACH ROW WHEN (NEW.assinatura_id = '${s.assinaturaId}') EXECUTE FUNCTION d42_falha()`);
    try {
      const logs: [string, Record<string, unknown>][] = [];
      const r = await cancelarAssinatura(s.ctx, {}, AGORA, { mp, log: (e, c) => logs.push([e, c]) });
      expect(r).toEqual({ resultado: 'tente_novamente' });
      expect(logs).toEqual([['assinatura.cancelar_pos_provedor_falhou', { assinaturaId: s.assinaturaId }]]);
      expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
      expect((await mp.consultarAssinatura(s.simId!)).estado).toBe('cancelada');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER d42_falha ON assinatura_transicao');
    }
    expect(await cancelarAssinatura(s.ctx, {}, AGORA, { mp })).toMatchObject({ resultado: 'cancelada' });
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('cancelada');
  });

  it('o provedor é chamado sem transação aberta (pg_stat_activity)', async () => {
    const s = await salaoGestor('ativa', { periodoPagoAte: PAGO_ATE });
    const abertas: number[] = [];
    const e = espiar(async () => {
      const r = await obterPrisma().$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`;
      abertas.push(r[0].n);
    });
    await cancelarAssinatura(s.ctx, {}, AGORA, { mp: e });
    expect(e.chamadas).toEqual(['cancelarAssinatura']);
    expect(abertas).toEqual([0]);
  });
});
