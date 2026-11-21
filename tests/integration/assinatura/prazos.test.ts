import { afterAll, describe, expect, it, vi } from 'vitest';

import { LOTE_PRAZOS } from '@/server/assinatura/config';
import { processarPrazos } from '@/server/assinatura/prazos';
import { aplicarEventoAssinatura } from '@/server/assinatura/servico';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { criarRepoAssinaturaSistema } from '@/server/repos/assinatura';

import {
  criarAssinaturaEm,
  criarSalaoComAssinatura,
  criarSalaoSemAssinatura,
  iso,
  lerAssinatura,
  pagamentosDe,
  transicoesDe,
} from '../../support/assinatura';

// D-037: CA-3, CA-5 (job), CA-13, CA-15, lote > 100 e CA-17 (falha isolada). Cada teste usa instantes
// próprios no passado remoto para não pegar linhas de outros arquivos: filtramos por salão.

afterAll(async () => {
  await encerrarPrisma();
});

const d = (s: string) => new Date(s);
const AGORA = d('2027-03-10T00:00:00Z');

/** Roda o job e devolve só o que aconteceu nos salões do teste. */
async function rodar(agora: Date, ids: string[]) {
  const logs: string[] = [];
  const res = await processarPrazos(agora, { log: (e) => logs.push(e) });
  return { res, logs, ids };
}

describe('processarPrazos', () => {
  it('CA-3: carência vencida -> suspensa (1 transição); 2ª execução não escreve; limite inclusivo', async () => {
    const s = await criarSalaoComAssinatura('em_carencia', { carenciaAte: AGORA, primeiraFalhaEm: d('2027-03-07T00:00:00Z') });
    const antes = d('2027-03-09T23:59:59.999Z');
    const naoVence = await criarSalaoComAssinatura('em_carencia', { carenciaAte: AGORA });
    await processarPrazos(antes);
    expect((await lerAssinatura(naoVence.assinaturaId)).estado).toBe('em_carencia');
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('em_carencia');

    await processarPrazos(AGORA);
    const a1 = await lerAssinatura(s.assinaturaId);
    expect(a1.estado).toBe('suspensa');
    const t = await transicoesDe(s.assinaturaId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ de: 'em_carencia', para: 'suspensa', causa: 'prazo_carencia' });
    await processarPrazos(d('2027-03-11T00:00:00Z'));
    const a2 = await lerAssinatura(s.assinaturaId);
    expect(iso(a2.atualizadoEm)).toBe(iso(a1.atualizadoEm));
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('CA-15: teste vencido sem pagamento -> carência (+3d); aprovada depois -> ativa a partir do pagamento', async () => {
    const s = await criarSalaoComAssinatura('em_teste', { testeFimEm: d('2027-03-01T00:00:00Z') });
    await processarPrazos(d('2027-03-02T00:00:00Z'));
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('em_carencia');
    expect(iso(a.primeiraFalhaEm)).toBe('2027-03-01T00:00:00.000Z');
    expect(iso(a.carenciaAte)).toBe('2027-03-04T00:00:00.000Z');
    const quando = d('2027-03-03T00:00:00Z');
    await aplicarEventoAssinatura(s.ctx, { tipo: 'cobranca_aprovada', pagamentoId: 'p15-' + s.salaoId, valorCentavos: 7900, pagoEm: quando }, quando);
    const b = await lerAssinatura(s.assinaturaId);
    expect(b.estado).toBe('ativa');
    expect(iso(b.periodoPagoAte)).toBe('2027-04-03T00:00:00.000Z');
    expect((await transicoesDe(s.assinaturaId)).map((t) => t.para)).toEqual(['em_carencia', 'ativa']);
  });

  it('RN-12: teste e carência já vencidos na mesma execução -> duas transições', async () => {
    const s = await criarSalaoComAssinatura('em_teste', { testeFimEm: d('2027-02-01T00:00:00Z') });
    await processarPrazos(AGORA);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('suspensa');
    // as duas têm o mesmo `ocorrida_em` (relógio injetado): compara sem depender da ordem
    expect((await transicoesDe(s.assinaturaId)).map((t) => `${t.de}>${t.para}:${t.causa}`).sort()).toEqual([
      'em_carencia>suspensa:prazo_carencia',
      'em_teste>em_carencia:prazo_teste',
    ]);
  });

  it('CA-5/CA-13: cancelada encerra após acesso_ate sem tocar pagamentos; libera nova assinatura', async () => {
    const s = await criarSalaoComAssinatura('cancelada', { acessoAte: d('2027-03-31T00:00:00Z'), canceladaEm: d('2027-03-10T00:00:00Z') });
    await processarPrazos(d('2027-03-30T00:00:00Z'));
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('cancelada');
    await processarPrazos(d('2027-03-31T00:00:00Z'));
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('encerrada');
    expect((await transicoesDe(s.assinaturaId))[0]).toMatchObject({ de: 'cancelada', para: 'encerrada', causa: 'prazo_acesso' });
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
    await expect(criarAssinaturaEm(s.salaoId, 'pendente')).resolves.toBeTruthy();
  });

  it('lote maior que 100: todas as vencidas transitam', async () => {
    const tamanho = LOTE_PRAZOS + 30;
    const ids: string[] = [];
    for (let i = 0; i < tamanho; i++) {
      const s = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
      ids.push(s.assinaturaId);
    }
    const { res } = await rodar(AGORA, ids);
    expect(res.examinadas).toBeGreaterThanOrEqual(tamanho);
    const estados = await obterPrisma().assinatura.findMany({ where: { id: { in: ids } }, select: { estado: true } });
    expect(estados.every((e) => e.estado === 'suspensa')).toBe(true);
  }, 120_000);

  it('CA-17: falha numa assinatura não impede as demais; log só com ids', async () => {
    const a = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
    const b = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
    const log = vi.fn();
    const res = await processarPrazos(AGORA, {
      log,
      aplicar: async (ctx, ev, agora, o) => {
        if (o?.assinaturaId === a.assinaturaId) throw new Error('boom');
        return aplicarEventoAssinatura(ctx, ev, agora, o);
      },
    });
    expect(res.falhas).toBe(1);
    expect((await lerAssinatura(a.assinaturaId)).estado).toBe('em_carencia');
    expect((await lerAssinatura(b.assinaturaId)).estado).toBe('suspensa');
    expect(log).toHaveBeenCalledWith('assinatura.prazo_falhou', { assinaturaId: a.assinaturaId, salaoId: a.salaoId });
    expect(JSON.stringify(log.mock.calls)).not.toContain('boom');
  });

  it('linha travada por outra transação: job responde ocupada e não espera', async () => {
    const s = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const pronto = new Promise<void>((r) => (travou = r));
    const dono = aplicarEventoAssinatura(
      s.ctx,
      { tipo: 'cobranca_falhou', pagamentoId: 'ocup-' + s.salaoId, falhouEm: AGORA },
      AGORA,
      {
        aposRegistrarPagamento: async () => {
          travou();
          await segura;
        },
      },
    );
    await pronto;
    const r = await aplicarEventoAssinatura(s.ctx, { tipo: 'prazo' }, AGORA, { assinaturaId: s.assinaturaId, pularTravada: true });
    expect(r).toEqual({ resultado: 'ocupada' });
    soltar();
    await dono;
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('em_carencia');
  });

  it('listarVencidas respeita o cursor e ignora estados sem prazo', async () => {
    const sem = await criarSalaoSemAssinatura();
    const ativa = await criarAssinaturaEm(sem.salaoId, 'ativa');
    const v = await criarSalaoComAssinatura('em_carencia', { carenciaAte: d('2027-03-09T00:00:00Z') });
    const repo = criarRepoAssinaturaSistema();
    const todas = await repo.listarVencidas(AGORA, null, 100000);
    expect(todas.map((x) => x.id)).toContain(v.assinaturaId);
    expect(todas.map((x) => x.id)).not.toContain(ativa);
    const depois = await repo.listarVencidas(AGORA, v.assinaturaId, 100000);
    expect(depois.map((x) => x.id)).not.toContain(v.assinaturaId);
  });
});
