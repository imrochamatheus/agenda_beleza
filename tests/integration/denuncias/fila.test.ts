import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerDetalheDaAvaliacao, listarFilaModeracao } from '@/server/denuncias/leitura';
import { retirarAvaliacao } from '@/server/denuncias/moderacao';
import { POR_PAGINA_FILA } from '@/server/denuncias/tipos';
import { lerFiltrosDaFila } from '@/server/denuncias/validacao';
import { denunciarAvaliacao } from '@/server/denuncias/denunciar';

import { criarSuperAdmin } from '../../support/auditoria';
import { AGORA, criarAvaliacao, entradaDenuncia, semearPendentes } from '../../support/denuncias';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';
import { ctxPublico, salaoNovo } from '../avaliacoes/apoio';

// D-035 CA-10: fila com filtros por salão e estado, paginação estável e nenhum dado pessoal da cliente.
let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

const filtro = (o: Partial<{ salao: string; estado: string; pagina: string }> = {}) => lerFiltrosDaFila(o);

describe('CA-10: fila de moderação', () => {
  it('filtra por salão e por estado; conta pendentes e motivos; não vaza dados pessoais', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const a = await salaoNovo();
    const b = await salaoNovo();
    const visivel = await criarAvaliacao(c, a, { nome: 'Ana L.', comentario: 'Gostei' });
    const denunciada = await criarAvaliacao(c, a, { nome: 'Bia S.', comentario: '<b>html</b>' });
    const retirada = await criarAvaliacao(c, a);
    const outroSalao = await criarAvaliacao(c, b);
    await denunciarAvaliacao(ctxPublico(a), entradaDenuncia(denunciada.avaliacaoId, { ip: ipNovo(), motivo: 'falso' }), AGORA);
    await denunciarAvaliacao(ctxPublico(a), entradaDenuncia(denunciada.avaliacaoId, { ip: ipNovo(), motivo: 'spam' }), AGORA);
    await retirarAvaliacao(ctx, { avaliacaoId: retirada.avaliacaoId, motivo: 'Motivo qualquer' }, AGORA);

    const ids = async (f: ReturnType<typeof filtro>) => (await listarFilaModeracao(ctx, f)).itens.map((i) => i.id);
    const doSalaoA = await ids(filtro({ salao: a.salaoId }));
    expect(new Set(doSalaoA)).toEqual(new Set([visivel.avaliacaoId, denunciada.avaliacaoId, retirada.avaliacaoId]));
    expect(await ids(filtro({ salao: b.salaoId }))).toEqual([outroSalao.avaliacaoId]);
    expect(new Set(await ids(filtro({ salao: a.salaoId, estado: 'visivel' })))).toEqual(new Set([visivel.avaliacaoId, denunciada.avaliacaoId]));
    expect(await ids(filtro({ salao: a.salaoId, estado: 'retirada' }))).toEqual([retirada.avaliacaoId]);
    expect(await ids(filtro({ salao: a.salaoId, estado: 'com_denuncia_pendente' }))).toEqual([denunciada.avaliacaoId]);

    const fila = await listarFilaModeracao(ctx, filtro({ salao: a.salaoId, estado: 'com_denuncia_pendente' }));
    expect(fila.total).toBe(1);
    expect(fila.itens[0]).toMatchObject({ pendentes: 2, motivos: ['falso', 'spam'], nome: 'Bia S.', comentario: '<b>html</b>', salaoId: a.salaoId, naoPublicada: false });
    const todos = JSON.stringify(await listarFilaModeracao(ctx, filtro({ salao: a.salaoId })));
    expect(todos).not.toMatch(/telefone|\+55|cliente_id|clienteId|@/);
    for (const k of [visivel, denunciada, retirada]) expect(todos).not.toContain(k.clienteId);
  });

  it('paginação estável: 20 por página, ordem criado_em DESC e id DESC, sem repetir nem perder', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const criadas: string[] = [];
    for (let i = 0; i < 45; i++) criadas.push((await criarAvaliacao(c, s)).avaliacaoId);
    // Empates de criado_em: o desempate por id decide.
    await c.query('UPDATE avaliacao SET criado_em = $2 WHERE salao_id = $1', [s.salaoId, new Date('2026-11-01T10:00:00Z')]);
    const paginas = [];
    for (const p of ['1', '2', '3', '4']) paginas.push(await listarFilaModeracao(ctx, filtro({ salao: s.salaoId, pagina: p })));
    expect(paginas.map((p) => p.itens.length)).toEqual([POR_PAGINA_FILA, POR_PAGINA_FILA, 5, 0]);
    expect(paginas.every((p) => p.total === 45)).toBe(true);
    const todos = paginas.flatMap((p) => p.itens.map((i) => i.id));
    expect(new Set(todos).size).toBe(45);
    expect(todos).toEqual([...criadas].sort().reverse());
    const outra = await listarFilaModeracao(ctx, filtro({ salao: s.salaoId, pagina: '2' }));
    expect(outra.itens.map((i) => i.id)).toEqual(paginas[1].itens.map((i) => i.id));
  });

  it('avaliação não publicada (cliente anonimizada ou reserva não concluída) fica na fila com o aviso', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await semearPendentes(c, s, a.avaliacaoId, 1);
    await c.query('UPDATE cliente SET anonimizada_em = now(), nome = NULL, telefone_e164 = NULL WHERE id = $1', [a.clienteId]);
    await c.query('UPDATE avaliacao SET nome_exibicao = NULL, comentario = NULL WHERE id = $1', [a.avaliacaoId]);
    const fila = await listarFilaModeracao(ctx, filtro({ salao: s.salaoId, estado: 'com_denuncia_pendente' }));
    expect(fila.itens[0]).toMatchObject({ id: a.avaliacaoId, naoPublicada: true, nome: null, comentario: null, pendentes: 1 });
  });

  it('detalhe: avaliação e todas as denúncias (texto só para o admin); inexistente e malformado dão null', async () => {
    const { ctx } = await criarSuperAdmin(c);
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(a.avaliacaoId, { ip: ipNovo(), motivo: 'dados_pessoais', texto: 'Cita meu nome' }), AGORA);
    const d = await lerDetalheDaAvaliacao(ctx, a.avaliacaoId);
    expect(d).toMatchObject({ id: a.avaliacaoId, salaoId: s.salaoId, nome: 'Cliente T.', naoPublicada: false });
    expect(d?.denuncias).toHaveLength(1);
    expect(d?.denuncias[0]).toMatchObject({ motivo: 'dados_pessoais', texto: 'Cita meu nome', resolvidaEm: null, resolucao: null });
    expect(JSON.stringify(d)).not.toContain(a.clienteId);
    expect(await lerDetalheDaAvaliacao(ctx, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await lerDetalheDaAvaliacao(ctx, 'x')).toBeNull();
  });
});
