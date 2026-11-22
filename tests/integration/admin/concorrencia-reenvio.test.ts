import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { reenviarMensagemAdmin } from '@/server/admin/mensagens';
import { obterPrisma } from '@/server/repos/db';
import { criarReconciliarMensagens } from '@/worker/handlers/reconciliar-mensagens';
import type { ContextoJob } from '@/worker/handlers/tipos';

import { adminDeTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { chamadasDaChave, criarCenarioMensagem, criarMensagem, lerMensagem, lerTentativas } from '../../support/mensagens';
import { conectar } from '../../support/sql';
import { esperar } from '../../support/fila';
import { criarPipeline, esperarMensagem } from '../mensagens/apoio';
import type { Pipeline } from '../mensagens/apoio';

// D-045 CA-11: reenvio concorrente. Duas ou dez confirmações da mesma `falhou`: exatamente uma
// `reenfileirada`, as demais `nao_falhou`, 1 auditoria, 1 job, 1 chamada ao adaptador. Reenvio ×
// reconciliação: 1 chamada, sem impasse (40P01) nem 23505. Estabilidade ×10 no comando documentado.
let p: Pipeline;
let c: pg.Client;
let adm: AdminDeTeste;
const MIN = 60_000;
const ctxJob = (): ContextoJob => ({ id: 'j', fila: 'reconciliar-mensagens', tentativa: 1, tentativasMaximas: 5, agendadoPara: new Date(), sinal: new AbortController().signal, log: () => {} });

beforeAll(async () => {
  p = await criarPipeline();
  c = await conectar();
  adm = await adminDeTeste();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
  await c?.end();
});

async function falhou(atrasoMs = 0) {
  const s = await criarCenarioMensagem();
  const id = await criarMensagem({
    salaoId: s.salaoId,
    reservaId: s.reservaId,
    estado: 'falhou',
    erroCodigo: 'resultado_incerto',
    destinatarioE164: s.telefone,
    atualizadoEm: new Date(Date.now() - atrasoMs),
    tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }],
  });
  return { s, id, chave: `${s.reservaId}:confirmacao:0` };
}

const jobsDaChave = async (chave: string): Promise<number> => {
  const [r] = await obterPrisma().$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE singleton_key = ${chave}`;
  return r.n;
};

function semFalha<T>(rs: PromiseSettledResult<T>[]): T[] {
  const falhas = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason));
  expect(falhas).toEqual([]);
  return rs.map((r) => (r as PromiseFulfilledResult<T>).value);
}

describe('CA-11: reenviar × reenviar', () => {
  it.each([2, 10])('%i confirmações simultâneas: 1 reenfileirada, o resto nao_falhou, 1 auditoria, 1 job, 1 chamada', async (n) => {
    const { id, chave } = await falhou();
    const rs = semFalha(
      await Promise.allSettled(Array.from({ length: n }, () => reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: p.enfileirar }))),
    );
    expect(rs.filter((r) => r.resultado === 'reenfileirada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'recusada' && r.motivo === 'nao_falhou')).toHaveLength(n - 1);
    expect(await linhasDeAuditoria(c, `acao = 'mensagem.reenviar' AND entidade_id = $1`, [id])).toHaveLength(1);
    await esperarMensagem(id, 'enviada');
    expect(await jobsDaChave(chave)).toBe(1);
    expect(await chamadasDaChave(chave)).toHaveLength(1);
    expect((await lerTentativas(id)).map((t) => t.numero)).toEqual([1, 2]);
  }, 40_000);

  it('determinístico (pg_stat_activity): com a linha travada por fora, os dois esperam; ao soltar, um vence', async () => {
    const { id } = await falhou();
    const ext = await conectar();
    try {
      await ext.query('BEGIN');
      await ext.query('SELECT id FROM mensagem WHERE id = $1 FOR UPDATE', [id]);
      const t = [1, 2].map(() => reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: p.enfileirar }));
      await esperar(async () => {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database() AND query ILIKE '%FROM mensagem%FOR UPDATE%'`,
        );
        return Number(rows[0].n) >= 2 ? true : null;
      }, 15_000, 'dois reenvios esperando a trava da mensagem');
      await ext.query('COMMIT');
      const rs = semFalha(await Promise.allSettled(t));
      expect(rs.filter((r) => r.resultado === 'reenfileirada')).toHaveLength(1);
      expect(rs.filter((r) => r.resultado === 'recusada')).toHaveLength(1);
      await esperarMensagem(id, 'enviada');
    } finally {
      await ext.query('ROLLBACK').catch(() => {});
      await ext.end();
    }
  }, 40_000);
});

describe('CA-11: reenviar × reconciliação', () => {
  it('reconciliação rodando junto (relógio adiantado, a pendente já "velha"): 1 chamada, sem impasse nem 23505', async () => {
    for (let i = 0; i < 3; i++) {
      const { id, chave } = await falhou(10 * MIN);
      const reconciliar = criarReconciliarMensagens({ enfileirar: p.enfileirar, agora: () => new Date(Date.now() + 10 * MIN) });
      const acoes: Promise<unknown>[] = [
        reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: p.enfileirar }),
        reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: p.enfileirar }),
        reconciliar.processar({}, ctxJob()),
        reconciliar.processar({}, ctxJob()),
      ];
      semFalha(await Promise.allSettled(acoes));
      await esperarMensagem(id, 'enviada');
      expect(await chamadasDaChave(chave)).toHaveLength(1);
      expect(await jobsDaChave(chave)).toBe(1);
      expect((await lerMensagem(id)).estado).toBe('enviada');
      expect(await linhasDeAuditoria(c, `acao = 'mensagem.reenviar' AND entidade_id = $1`, [id])).toHaveLength(1);
    }
  }, 60_000);
});
