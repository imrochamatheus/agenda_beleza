import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { denunciarAvaliacao } from '@/server/denuncias/denunciar';
import { arquivarDenuncias, restaurarAvaliacao, retirarAvaliacao } from '@/server/denuncias/moderacao';
import { criarAdminContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { contarAuditoria, criarSuperAdmin, linhasDeAuditoria } from '../../support/auditoria';
import { AGORA, contarMensagens, criarAvaliacao, denunciasDe, entradaDenuncia, linhaDaAvaliacao, semearPendentes } from '../../support/denuncias';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';
import { ctxPublico, salaoNovo } from '../avaliacoes/apoio';

// D-035 CA-6, CA-7, CA-8, CA-11, CA-12, CA-13 e a visibilidade derivada (média, contagem e lista).
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const MOTIVO = 'Linguagem ofensiva contra a equipe';

describe('CA-6: retirar', () => {
  it('some da página, da média e da contagem; grava retirada_por; resolve pendentes; audita antes/depois', async () => {
    const { usuarioId, ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a1 = await criarAvaliacao(c, s, { nota: 5 });
    const a2 = await criarAvaliacao(c, s, { nota: 3 });
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a1.avaliacaoId, { ip: ipNovo() }), AGORA);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a1.avaliacaoId, { ip: ipNovo() }), AGORA);
    expect(await lerAvaliacoesPublicas(ctxPublico(s))).toMatchObject({ total: 2, media: 4 });

    const r = await retirarAvaliacao(ctx, { avaliacaoId: a1.avaliacaoId, motivo: MOTIVO }, AGORA);
    expect(r).toEqual({ resultado: 'ok' });

    const pub = await lerAvaliacoesPublicas(ctxPublico(s));
    expect(pub).toMatchObject({ total: 1, media: 3 });
    expect(pub.itens.map((i) => i.id)).toEqual([a2.avaliacaoId]);
    expect(await linhaDaAvaliacao(c, a1.avaliacaoId)).toEqual({ retirada_em: AGORA, retirada_por: usuarioId });
    const den = await denunciasDe(c, a1.avaliacaoId);
    expect(den).toHaveLength(2);
    for (const d of den) expect(d).toMatchObject({ resolucao: 'retirada', resolvida_por: usuarioId, resolvida_em: AGORA });

    const aud = await linhasDeAuditoria(c, `acao = 'avaliacao.retirar' AND entidade_id = $1`, [a1.avaliacaoId]);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ ator_id: usuarioId, entidade: 'avaliacao', salao_id: s.salaoId, resultado: 'sucesso' });
    expect(aud[0].antes).toEqual({ retirada_em: null, retirada_por: null });
    expect(aud[0].depois).toEqual({ retirada_em: AGORA.toISOString(), retirada_por: usuarioId, motivo: MOTIVO });
    expect(JSON.stringify(aud[0])).not.toContain('Ótimo atendimento');
    expect(JSON.stringify(aud[0])).not.toContain('Cliente T.');
  });

  it('falha da auditoria desfaz a retirada e a resolução das denúncias (mesma transação)', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo() }), AGORA);
    // Admin inexistente: o INSERT da auditoria viola a FK de ator_id depois do UPDATE.
    const fantasma = criarAdminContext(randomUUID());
    await expect(retirarAvaliacao(fantasma, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO }, AGORA)).rejects.toThrow(/foreign key|ator_id|violat/i);
    expect(await linhaDaAvaliacao(c, a.avaliacaoId)).toEqual({ retirada_em: null, retirada_por: null });
    expect((await denunciasDe(c, a.avaliacaoId))[0].resolvida_em).toBeNull();
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(1);
  });

  it('CA-12: motivo vazio, curto, longo, com e-mail ou telefone é recusado sem escrever', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const antes = await contarAuditoria(c);
    for (const motivo of ['', '   ', 'ab', 'x'.repeat(301), 'falar com maria@exemplo.com', 'ligar (11) 98765-4321', 'tel 11987654321', 'contato +55 11 98765-4321', undefined, 42]) {
      const r = await retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo }, AGORA);
      expect(r).toMatchObject({ resultado: 'invalido' });
    }
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    expect(await contarAuditoria(c)).toBe(antes);
    expect(await retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: 'x'.repeat(300) }, AGORA)).toEqual({ resultado: 'ok' });
  });

  it('avaliação inexistente ou id malformado é NaoEncontrado, sem escrever', async () => {
    const { ctx } = await criarSuperAdmin(c);
    await expect(retirarAvaliacao(ctx, { avaliacaoId: randomUUID(), motivo: MOTIVO }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(retirarAvaliacao(ctx, { avaliacaoId: 'x', motivo: MOTIVO }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(restaurarAvaliacao(ctx, { avaliacaoId: randomUUID(), motivo: MOTIVO })).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(arquivarDenuncias(ctx, { avaliacaoId: randomUUID() }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(arquivarDenuncias(ctx, { avaliacaoId: randomUUID(), denunciaId: 'x' }, AGORA)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('contexto que não é de admin é erro de programação', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await expect(retirarAvaliacao(ctxPublico(s) as never, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO }, AGORA)).rejects.toThrow('AdminContext');
  });
});

describe('CA-7: restaurar', () => {
  it('reaparece, zera as colunas, audita antes/depois e não reabre denúncias', async () => {
    const { usuarioId, ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo() }), AGORA);
    await retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO }, AGORA);
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(0);

    const r = await restaurarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: 'Retirada indevida' });
    expect(r).toEqual({ resultado: 'ok' });
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(1);
    expect(await linhaDaAvaliacao(c, a.avaliacaoId)).toEqual({ retirada_em: null, retirada_por: null });
    expect((await denunciasDe(c, a.avaliacaoId))[0].resolucao).toBe('retirada');
    const aud = await linhasDeAuditoria(c, `acao = 'avaliacao.restaurar' AND entidade_id = $1`, [a.avaliacaoId]);
    expect(aud).toHaveLength(1);
    expect(aud[0].antes).toEqual({ retirada_em: AGORA.toISOString(), retirada_por: usuarioId });
    expect(aud[0].depois).toEqual({ retirada_em: null, retirada_por: null, motivo: 'Retirada indevida' });
  });

  it('restaurar avaliação visível é recusado sem escrita nem auditoria', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const antes = await contarAuditoria(c);
    expect(await restaurarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO })).toEqual({ resultado: 'recusado', motivo: 'estado_atual' });
    expect(await restaurarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: '' })).toMatchObject({ resultado: 'invalido' });
    expect(await contarAuditoria(c)).toBe(antes);
  });
});

describe('CA-8: retirar duas vezes', () => {
  it('em fila: a segunda é recusada; em paralelo: 1 efeito e 1 auditoria', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const rs = await Promise.all([1, 2, 3].map(() => retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO }, AGORA)));
    expect(rs.filter((r) => r.resultado === 'ok')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'recusado')).toHaveLength(2);
    expect(await linhasDeAuditoria(c, `acao = 'avaliacao.retirar' AND entidade_id = $1`, [a.avaliacaoId])).toHaveLength(1);
    expect(await retirarAvaliacao(ctx, { avaliacaoId: a.avaliacaoId, motivo: MOTIVO }, AGORA)).toEqual({ resultado: 'recusado', motivo: 'estado_atual' });
  });
});

describe('CA-11: arquivar', () => {
  it('uma denúncia: resolve só ela como mantida, não altera a avaliação e audita', async () => {
    const { usuarioId, ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo() }), AGORA);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo() }), AGORA);
    const [d1, d2] = await denunciasDe(c, a.avaliacaoId);
    expect(await arquivarDenuncias(ctx, { avaliacaoId: a.avaliacaoId, denunciaId: d1.id }, AGORA)).toEqual({ resultado: 'ok' });
    const depois = await denunciasDe(c, a.avaliacaoId);
    expect(depois.find((d) => d.id === d1.id)).toMatchObject({ resolucao: 'mantida', resolvida_por: usuarioId, resolvida_em: AGORA });
    expect(depois.find((d) => d.id === d2.id)?.resolvida_em).toBeNull();
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    const aud = await linhasDeAuditoria(c, `acao = 'avaliacao.denuncia_resolver' AND salao_id = $1`, [s.salaoId]);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ entidade: 'avaliacao_denuncia', entidade_id: d1.id, depois: { resolucao: 'mantida', quantidade: 1 } });
  });

  it('todas as pendentes: uma auditoria com a quantidade; sem pendentes é recusado sem auditoria', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await semearPendentes(c, s, a.avaliacaoId, 3);
    expect(await arquivarDenuncias(ctx, { avaliacaoId: a.avaliacaoId }, AGORA)).toEqual({ resultado: 'ok' });
    const aud = await linhasDeAuditoria(c, `acao = 'avaliacao.denuncia_resolver' AND salao_id = $1`, [s.salaoId]);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ entidade_id: a.avaliacaoId, depois: { resolucao: 'mantida', quantidade: 3 } });
    expect(await arquivarDenuncias(ctx, { avaliacaoId: a.avaliacaoId }, AGORA)).toEqual({ resultado: 'recusado', motivo: 'sem_pendentes' });
    expect(await linhasDeAuditoria(c, `acao = 'avaliacao.denuncia_resolver' AND salao_id = $1`, [s.salaoId])).toHaveLength(1);
  });

  it('denúncia de outra avaliação não é resolvida pelo id (escopo pela avaliação)', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const b = await criarAvaliacao(c, s);
    await semearPendentes(c, s, b.avaliacaoId, 1);
    const [db] = await denunciasDe(c, b.avaliacaoId);
    expect(await arquivarDenuncias(ctx, { avaliacaoId: a.avaliacaoId, denunciaId: db.id }, AGORA)).toEqual({ resultado: 'recusado', motivo: 'sem_pendentes' });
    expect((await denunciasDe(c, b.avaliacaoId))[0].resolvida_em).toBeNull();
  });
});

describe('visibilidade derivada e CA-13', () => {
  it('uma retirada em um salão não afeta o outro; retirar e restaurar não enfileiram nada', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const a = await salaoNovo();
    const b = await salaoNovo();
    const aa = await criarAvaliacao(c, a, { nota: 4 });
    await criarAvaliacao(c, b, { nota: 2 });
    const msgs = await contarMensagens(c);
    const emails = Number((await c.query('SELECT count(*) AS n FROM email_log')).rows[0].n);
    await retirarAvaliacao(ctx, { avaliacaoId: aa.avaliacaoId, motivo: MOTIVO }, AGORA);
    await restaurarAvaliacao(ctx, { avaliacaoId: aa.avaliacaoId, motivo: MOTIVO });
    await retirarAvaliacao(ctx, { avaliacaoId: aa.avaliacaoId, motivo: MOTIVO }, AGORA);
    expect(await lerAvaliacoesPublicas(ctxPublico(a))).toEqual({ total: 0, media: null, itens: [] });
    expect(await lerAvaliacoesPublicas(ctxPublico(b))).toMatchObject({ total: 1, media: 2 });
    expect(await contarMensagens(c)).toBe(msgs);
    expect(Number((await c.query('SELECT count(*) AS n FROM email_log')).rows[0].n)).toBe(emails);
    const pgboss = await c.query(`SELECT to_regclass('pgboss.job') AS t`);
    if (pgboss.rows[0].t !== null) {
      const { rows } = await c.query(`SELECT count(*)::int AS n FROM pgboss.job WHERE data::text LIKE $1`, [`%${aa.avaliacaoId}%`]);
      expect(rows[0].n).toBe(0);
    }
  });
});
