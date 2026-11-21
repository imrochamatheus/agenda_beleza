import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { denunciarAvaliacao } from '@/server/denuncias/denunciar';
import { arquivarDenuncias, restaurarAvaliacao, retirarAvaliacao } from '@/server/denuncias/moderacao';

import { criarSuperAdmin, linhasDeAuditoria } from '../../support/auditoria';
import { AGORA, criarAvaliacao, denunciasDe, entradaDenuncia, linhaDaAvaliacao, SEMPRE_PERMITIDO } from '../../support/denuncias';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';
import { ctxPublico, salaoNovo } from '../avaliacoes/apoio';

// D-035 R-2/CA-4/CA-8: retirar x restaurar x arquivar x denunciar em paralelo, sem impasse, 5xx nem estado
// incoerente. Estabilidade: ver o laço de 10 execuções em CLAUDE.md.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const M = 'Motivo da moderação';

describe('concorrência da moderação', () => {
  it('retirar x restaurar x arquivar x denunciar: termina, estado final coerente com a auditoria', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await c.query(`UPDATE avaliacao SET retirada_em = now(), retirada_por = $2 WHERE id = $1`, [a.avaliacaoId, ctx.usuarioId]);
    const tarefas: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      tarefas.push(retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: M }, AGORA));
      tarefas.push(restaurarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: M }));
      tarefas.push(arquivarDenuncias(ctx, { avaliacaoId: a.avaliacaoId }, AGORA));
      tarefas.push(denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo() }), AGORA, { limitarPorIp: SEMPRE_PERMITIDO }));
    }
    const rs = await Promise.allSettled(tarefas);
    expect(rs.filter((r) => r.status === 'rejected')).toEqual([]);
    const retiradas = (await linhasDeAuditoria(c, `acao = 'avaliacao.retirar' AND entidade_id = $1`, [a.avaliacaoId])).length;
    const restauradas = (await linhasDeAuditoria(c, `acao = 'avaliacao.restaurar' AND entidade_id = $1`, [a.avaliacaoId])).length;
    // Começou retirada: as operações bem-sucedidas se alternam (restaurar, retirar, restaurar, ...).
    expect([restauradas, restauradas - 1]).toContain(retiradas);
    const terminaRetirada = restauradas === retiradas;
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em !== null).toBe(terminaRetirada);
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(terminaRetirada ? 0 : 1);
    const den = await denunciasDe(c, a.avaliacaoId);
    for (const d of den) expect(d.resolvida_em === null).toBe(d.resolucao === null && d.resolvida_por === null);
  });

  it('10 retiradas paralelas: exatamente 1 ok e 1 auditoria; 10 denúncias do mesmo IP: 1 linha', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const ip = ipNovo();
    const [retiradas, denuncias] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: M }, AGORA))),
      Promise.all(Array.from({ length: 10 }, () => denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip }), AGORA, { limitarPorIp: SEMPRE_PERMITIDO }))),
    ]);
    expect(retiradas.filter((r) => r.resultado === 'ok')).toHaveLength(1);
    expect(denuncias.every((d) => d.resultado === 'recebida')).toBe(true);
    expect(await linhasDeAuditoria(c, `acao = 'avaliacao.retirar' AND entidade_id = $1`, [a.avaliacaoId])).toHaveLength(1);
    // A denúncia pode ter entrado antes (resolvida pela retirada), depois (avaliação já retirada: nada) ou, numa
    // corrida benigna, com o INSERT já planejado sobre a avaliação ainda visível, como pendente de uma avaliação
    // recém-retirada (o INSERT não trava a avaliação, D-035 §3). Nunca mais de uma pendente por IP.
    const den = await denunciasDe(c, a.avaliacaoId);
    expect(den.length).toBeLessThanOrEqual(2);
    expect(den.filter((d) => d.resolvida_em === null).length).toBeLessThanOrEqual(1);
  });
});
